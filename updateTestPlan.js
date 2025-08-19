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

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Basic auth header
const authHeader = () => `Basic ${Buffer.from(`:${ADO_PAT}`).toString('base64')}`;

// Azure DevOps REST API base URL
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Parse JUnit report
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];
  return testsuites.map((suite, i) => ({
    id: i + 1,
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
    name: `Automated Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    build: { id: BUILD_ID ? parseInt(BUILD_ID, 10) : undefined },
    pointIds:[1,2]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create test run: ${res.status} ${text}`);
  }

  return res.json();
}

// Fetch test points
async function getTestPoints() {
  const url = `${baseUrl}/plans/${ADO_TEST_PLAN_ID}/suites/${ADO_TEST_SUITE_ID}/points?api-version=7.1-preview.2`;
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`Failed to fetch test points: ${res.status}`);
  const data = await res.json();
  return data.value;
}

// Add test results using point IDs
async function addTestResults(runId, suites) {
  const points = await getTestPoints();
  if (!points.length) throw new Error('No test points found.');

  const payload = points.map((point, i) => {
    const suite = suites[i % suites.length];
    return {
      id: point.id,
      outcome: suite.failures > 0 ? 'Failed' : suite.skipped > 0 ? 'NotExecuted' : 'Passed',
      automatedTestName: suite.name,
      automatedTestType: 'Unit',
      testCaseTitle: suite.name,
    };
  });

  const url = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update test results: ${res.status} ${text}`);
  }

  console.log(`Updated ${payload.length} test results for run ${runId}.`);
  return res.json();
}

// Complete test run
async function completeTestRun(runId) {
  const url = `${baseUrl}/runs/${runId}?api-version=7.1-preview.2`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Completed' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete test run: ${res.status} ${text}`);
  }

  console.log(`Test run ${runId} completed.`);
  return res.json();
}

// Attach JUnit report to the run
async function attachJUnitReport(runId, filePath) {
  const fileContent = fs.readFileSync(path.resolve(filePath));
  const url = `${baseUrl}/runs/${runId}/attachments?api-version=7.1-preview.3`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/octet-stream',
    },
    body: fileContent,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to attach JUnit report: ${res.status} ${text}`);
  }

  console.log('JUnit report attached successfully.');
  return res.json();
}

// Main execution
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const suites = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Updating test results...');
    await addTestResults(run.id, suites);

    console.log('Attaching JUnit report...');
    await attachJUnitReport(run.id, TEST_REPORT_FILE);

    console.log('Completing test run...');
    await completeTestRun(run.id);

    console.log('All done! Test run is complete with results, build, and JUnit attachment.');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
