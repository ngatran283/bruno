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
const BUILD_ID = process.env.BUILD_BUILDID;
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Auth header
const authHeader = () => `Basic ${Buffer.from(`:${ADO_PAT}`).toString('base64')}`;
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Parse JUnit XML
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];
  return testsuites.flatMap(suite =>
    (suite.testcase || []).map(tc => ({
      name: tc.$.name,
      classname: tc.$.classname,
      failures: tc.failure ? 1 : 0,
      skipped: tc.skipped ? 1 : 0,
    }))
  );
}

// Get test points for the plan (optionally by suite)
async function getTestPoints() {
  let url = `${baseUrl}/plans/${ADO_TEST_PLAN_ID}/TestPoint?api-version=7.1-preview.2`;
  if (ADO_TEST_SUITE_ID) url += `&suiteId=${ADO_TEST_SUITE_ID}`;

  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get test points: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.value; // array of points
}

// Create test run
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Automated Run ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    build: { id: parseInt(BUILD_ID, 10) },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
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

// Map JUnit results to test point IDs and post results
async function addTestResults(runId, testPoints, junitCases) {
  const results = [];

  // Match JUnit test names with Azure DevOps test points
  junitCases.forEach(tc => {
    const point = testPoints.find(p => p.testCase.title === tc.name);
    if (point) {
      results.push({
        id: point.id,
        outcome: tc.failures > 0 ? 'Failed' : tc.skipped > 0 ? 'NotExecuted' : 'Passed',
        automatedTestName: tc.name,
        automatedTestType: 'Unit',
        testCaseTitle: tc.name,
      });
    }
  });

  if (results.length === 0) {
    throw new Error('No test points matched JUnit test cases.');
  }

  const url = `${baseUrl}/Runs/${runId}/results?api-version=7.1-preview.6`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(results),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add test results: ${res.status} ${text}`);
  }

  return res.json();
}

// Attach JUnit XML
async function attachJUnit(runId, filePath) {
  const fileName = path.basename(filePath);
  const url = `${baseUrl}/Runs/${runId}/attachments?api-version=7.1-preview.3`;

  const fileContent = fs.readFileSync(path.resolve(filePath));
  const payload = {
    attachmentType: 'GeneralAttachment',
    fileName,
    stream: fileContent.toString('base64'),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to attach JUnit XML: ${res.status} ${text}`);
  }

  return res.json();
}

// Complete test run
async function completeTestRun(runId) {
  const url = `${baseUrl}/Runs/${runId}?api-version=7.1-preview.2`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Completed' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete test run: ${res.status} ${text}`);
  }

  return res.json();
}

// Main
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const junitCases = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Fetching test points...');
    const testPoints = await getTestPoints();

    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Uploading test results...');
    await #!/usr/bin/env node

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
const BUILD_ID = process.env.BUILD_BUILDID;
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Auth header
const authHeader = () => `Basic ${Buffer.from(`:${ADO_PAT}`).toString('base64')}`;
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Parse JUnit XML
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];
  return testsuites.flatMap(suite =>
    (suite.testcase || []).map(tc => ({
      name: tc.$.name,
      classname: tc.$.classname,
      failures: tc.failure ? 1 : 0,
      skipped: tc.skipped ? 1 : 0,
    }))
  );
}

// Get test points for the plan (optionally by suite)
async function getTestPoints() {
  let url = `${baseUrl}/plans/${ADO_TEST_PLAN_ID}/points?api-version=7.1-preview.2`;
  if (ADO_TEST_SUITE_ID) url += `&suiteId=${ADO_TEST_SUITE_ID}`;

  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get test points: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.value; // array of points
}

// Create test run
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Automated Run ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    build: { id: parseInt(BUILD_ID, 10) },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
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

// Map JUnit results to test point IDs and post results
async function addTestResults(runId, testPoints, junitCases) {
  const results = [];

  // Match JUnit test names with Azure DevOps test points
  junitCases.forEach(tc => {
    const point = testPoints.find(p => p.testCase.title === tc.name);
    if (point) {
      results.push({
        id: point.id,
        outcome: tc.failures > 0 ? 'Failed' : tc.skipped > 0 ? 'NotExecuted' : 'Passed',
        automatedTestName: tc.name,
        automatedTestType: 'Unit',
        testCaseTitle: tc.name,
      });
    }
  });

  if (results.length === 0) {
    throw new Error('No test points matched JUnit test cases.');
  }

  const url = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(results),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add test results: ${res.status} ${text}`);
  }

  return res.json();
}

// Attach JUnit XML
async function attachJUnit(runId, filePath) {
  const fileName = path.basename(filePath);
  const url = `${baseUrl}/runs/${runId}/attachments?api-version=7.1-preview.3`;

  const fileContent = fs.readFileSync(path.resolve(filePath));
  const payload = {
    attachmentType: 'GeneralAttachment',
    fileName,
    stream: fileContent.toString('base64'),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to attach JUnit XML: ${res.status} ${text}`);
  }

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

  return res.json();
}

// Main
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const junitCases = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Fetching test points...');
    const testPoints = await getTestPoints();

    console.log('Creating test run...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log('Uploading test results...');
    await addTestResults(run.id, testPoints, junitCases);

    console.log('Attaching JUnit XML...');
    await attachJUnit(run.id, TEST_REPORT_FILE);

    console.log('Completing test run...');
    await completeTestRun(run.id);

    console.log('Test plan updated successfully with automated JUnit results!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
(run.id, testPoints, junitCases);

    console.log('Attaching JUnit XML...');
    await attachJUnit(run.id, TEST_REPORT_FILE);

    console.log('Completing test run...');
    await completeTestRun(run.id);

    console.log('Test plan updated successfully with automated JUnit results!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
