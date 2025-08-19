#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';

// Environment variables from pipeline
const ADO_ORG = process.env.ADO_ORG;
const ADO_PROJECT = process.env.ADO_PROJECT;
const ADO_PAT = process.env.ADO_PAT;
const ADO_TEST_PLAN_ID = process.env.ADO_TEST_PLAN_ID;
const ADO_TEST_SUITE_ID = process.env.ADO_TEST_SUITE_ID; // optional
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Basic auth header for Azure DevOps REST API
const authHeader = () => {
  const token = Buffer.from(`:${ADO_PAT}`).toString('base64');
  return `Basic ${token}`;
};

// Azure DevOps REST API base URL
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis`;

// Read and parse JUnit report
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];

 return  testsuites.map((suite) => ({
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
  const points = await getTestPoints();
  const pointIds = points.map(p => p.id);
  const url = `${baseUrl}/test/runs?api-version=7.1`;
  const body = {
    name: `Bruno Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    // Optional: include suite
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    pointIds: pointIds
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

// Fetch test points for the suite
async function getTestPoints() {
  const url = `${baseUrl}/testplan/Plans/${ADO_TEST_PLAN_ID}/suites/${ADO_TEST_SUITE_ID}/TestPoint?api-version=7.1`;
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch test points: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.value; // array of test points
}

// Get results for a test run and extract ID + test name
async function getTestResults(runId) {
  const url = `${baseUrl}/test/runs/${runId}/results?api-version=7.1`;

  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch test results: ${res.status} ${text}`);
  }

  const data = await res.json();

  // Extract value.id and testCaseTitle
  return data.value.map(r => ({
    id: r.id,
    title: r.testCaseTitle  }));
}


// Update test results using point IDs
async function addTestResults(runId, suites) {
  const points = getTestResults(runId);
  if (!points.length) throw new Error('No test points found for the suite.');

  // Map suites to points
const payload = [];

for (const point of points) {
  // Find matching suite by name (case-insensitive)
  const suite = suites.find(s => 
    s.name.toLowerCase() === (point.title || '').toLowerCase()
  );

  if (!suite) {
    console.warn(`⚠️ No matching suite found for test point "${point.title}" (ID ${point.id})`);
    continue;
  }
  payload.push({
    pointId: point.id, // ✅ use pointId, not id
    outcome:
      suite.failures > 0 ? 'Failed' :
      suite.skipped > 0 ? 'NotExecuted' : 'Passed',
    automatedTestName: suite.name,
    automatedTestType: 'Unit',
    testCaseTitle: suite.name,
  });
}

  const patchUrl = `${baseUrl}/test/runs/${runId}/results?api-version=7.1`;
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

  console.log(`Updated ${payload.length} test results for run ${runId}.`);
  return patchRes.json();
}

// Complete the test run to update statistics
async function completeTestRun(runId) {
  const url = `${baseUrl}/test/runs/${runId}?api-version=7.1`;
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

  console.log(`Test run ${runId} marked as Completed.`);
  return res.json();
}

// Main execution
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const results = await parseJUnitReport(TEST_REPORT_FILE);
results.map((suite) => {
  // Detailed logging
  console.log('-----------------------------------------');
  console.log(`Test Suite Name : ${suite.name}`);
  console.log(`Tests           : ${suite.tests}`);
  console.log('-----------------------------------------')});
    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Uploading test results...');
    await addTestResults(run.id, results);

    await completeTestRun(run.id);

    console.log('Test results uploaded successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
