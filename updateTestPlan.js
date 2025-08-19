#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

// Environment variables
const ADO_ORG = process.env.ADO_ORG;
const ADO_PROJECT = process.env.ADO_PROJECT;
const ADO_PAT = process.env.ADO_PAT;
const ADO_TEST_PLAN_ID = process.env.ADO_TEST_PLAN_ID;
const ADO_TEST_SUITE_ID = process.env.ADO_TEST_SUITE_ID; // optional
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;
const BUILD_ID = process.env.BUILD_BUILDID || '0';

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Basic auth
const authHeader = () => {
  const token = Buffer.from(`:${ADO_PAT}`).toString('base64');
  return `Basic ${token}`;
};

const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Parse JUnit report
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

// Create test run
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Automated Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    build: { id: parseInt(BUILD_ID, 10) },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Failed to create test run: ${res.statusText}`);
  return res.json();
}

// Update test results
async function addTestResults(runId, suites) {
  // 1️⃣ Fetch existing test results for the run
  const getUrl = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;
  const getRes = await fetch(getUrl, {
    method: 'GET',
    headers: { 'Authorization': authHeader() },
  });

  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`Failed to fetch test results: ${getRes.status} ${text}`);
  }

  const existingResults = await getRes.json();

  if (!existingResults.value || existingResults.value.length === 0) {
    throw new Error('No test results found for the run. Make sure pointIds are correct.');
  }

  // 2️⃣ Prepare payload to PATCH each existing result
  const payload = existingResults.value.map((result, index) => {
    const suite = suites[index % suites.length]; // map suite to result
    return {
      id: result.id, // MUST use existing test result id
      outcome:
        suite.failures > 0 ? 'Failed' :
        suite.skipped > 0 ? 'NotExecuted' : 'Passed',
      automatedTestName: suite.name,
      automatedTestType: 'Unit',
      testCaseTitle: suite.name,
    };
  });

  // 3️⃣ PATCH updated results
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

// Attach Bruno JUnit XML
async function attachBrunoJUnit(runId, filePath) {
  const fileData = fs.readFileSync(filePath);
  const url = `${baseUrl}/runs/${runId}/attachments?api-version=7.1-preview.3`;
  
  const body = JSON.stringify({
    stream: fileData.toString('base64'),
    fileName: path.basename(filePath),
    attachmentType: 'GeneralAttachment',
    comment: 'Bruno JUnit XML Report',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      'Authorization': authHeader(), 
      'Content-Type': 'application/json' 
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to attach Bruno JUnit XML: ${res.status} ${text}`);
  }

  console.log('Bruno JUnit XML attached successfully!');
}

// Complete the run
async function completeRun(runId) {
  const url = `${baseUrl}/runs/${runId}?api-version=7.1-preview.3`;
  const body = { state: 'Completed' };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Failed to complete run: ${res.statusText}`);
}

// Main
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const suites = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Updating test results...');
    await addTestResults(run.id, suites);

    console.log('Attaching Bruno JUnit XML...');
    await attachBrunoJUnit(run.id, TEST_REPORT_FILE);

    console.log('Completing test run...');
    await completeRun(run.id);

    console.log('Test run updated successfully!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
