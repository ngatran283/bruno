#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

// Environment variables from pipeline
const ADO_ORG = process.env.ADO_ORG;
const ADO_PROJECT = process.env.ADO_PROJECT;
const ADO_PAT = process.env.ADO_PAT;
const ADO_TEST_PLAN_ID = process.env.ADO_TEST_PLAN_ID;
const ADO_TEST_SUITE_ID = process.env.ADO_TEST_SUITE_ID; // optional
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;
const BUILD_ID = process.env.BUILD_BUILDID;

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE || !BUILD_ID) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Basic auth header for Azure DevOps REST API
const authHeader = () => {
  const token = Buffer.from(`:${ADO_PAT}`).toString('base64');
  return `Basic ${token}`;
};

// Azure DevOps REST API base URL
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Read and parse JUnit report
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];

  return testsuites.map((suite, index) => ({
    id: index + 1,
    name: suite.$.name,
    errors: parseInt(suite.$.errors, 10),
    failures: parseInt(suite.$.failures, 10),
    skipped: parseInt(suite.$.skipped, 10),
    tests: parseInt(suite.$.tests, 10),
    time: parseFloat(suite.$.time),
  }));
}

// Create a new test run
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Bruno Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    pointIds: [1, 2], // Adjust your point IDs here
    build: { id: parseInt(BUILD_ID, 10) }, // associate with build
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create test run: ${res.status} ${text}`);
  }

  return res.json();
}

// Add or update test results
async function addTestResults(runId, suites) {
  const getUrl = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;
  const getRes = await fetch(getUrl, { headers: { Authorization: authHeader() } });

  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`Failed to fetch test results: ${getRes.status} ${text}`);
  }

  const existingResults = await getRes.json();
  if (!existingResults.value || existingResults.value.length === 0) {
    throw new Error('No test results found for the run. Check your point IDs.');
  }

  const payload = existingResults.value.map((result, index) => {
    const suite = suites[index % suites.length];
    return {
      id: result.id,
      outcome: suite.failures > 0 ? 'Failed' : suite.skipped > 0 ? 'NotExecuted' : 'Passed',
      automatedTestName: suite.name,
      automatedTestType: 'Unit',
      testCaseTitle: suite.name,
    };
  });

  const patchUrl = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(`Failed to update test results: ${patchRes.status} ${text}`);
  }

  console.log(`Successfully updated ${payload.length} test results for run ${runId}.`);
  return patchRes.json();
}

// Attach JUnit XML to the test run
async function attachJUnit(runId, filePath) {
  const attachmentUrl = `${baseUrl}/runs/${runId}/attachments?api-version=7.1-preview.4`;
  const fileContent = fs.readFileSync(path.resolve(filePath), 'base64');

  const payload = {
    stream: fileContent,
    fileName: path.basename(filePath),
    comment: 'JUnit test report',
    attachmentType: 'GeneralAttachment', // use GeneralAttachment for report
  };

  const res = await fetch(attachmentUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to attach JUnit report: ${res.status} ${text}`);
  }

  console.log('JUnit report attached to test run.');
  return res.json();
}

// Complete the test run
async function completeTestRun(runId) {
  const url = `${baseUrl}/runs/${runId}?api-version=7.1-preview.2`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: 'Completed' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete test run: ${res.status} ${text}`);
  }

  console.log(`Test run ${runId} marked as completed.`);
}

// Main execution
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const results = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Uploading test results...');
    await addTestResults(run.id, results);

    console.log('Attaching JUnit XML...');
    await attachJUnit(run.id, TEST_REPORT_FILE);

    console.log('Completing test run...');
    await completeTestRun(run.id);

    console.log('Test results uploaded, report attached, and run completed successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
