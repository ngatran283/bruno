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
const BUILD_BUILDID = process.env.BUILD_BUILDID;

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

async function parseJUnitTestCases(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testCases = [];

  const testsuites = result.testsuites.testsuite || [];
  for (const suite of testsuites) {
    const cases = suite.testcase || [];
    for (const test of cases) {
      testCases.push({
        suiteName: suite.$.name,
        testName: test.$.name,
        classname: test.$.classname,
        time: parseFloat(test.$.time),
        status: test.$.status,
        failureMessage: test.failure ? test.failure[0].$.message : null,
      });
    }
  }
  return testCases;
}


// Create a new test run
async function createTestRun(pointIds) {
  const url = `${baseUrl}/test/runs?api-version=7.1`;
  const body = {
    name: `Bruno Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    // Optional: include suite
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    pointIds: pointIds,
    build: { id: BUILD_BUILDID }
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

// Upload Attachment (JUnit XML)
async function addRunAttachment(runId, filePath) {
  const url = `${baseUrl}/test/runs/${runId}/attachments?api-version=7.1`;
  const content = fs.readFileSync(filePath);

  const formData = {
    stream: content.toString('base64'), // must be base64
    fileName: path.basename(filePath),
    comment: 'JUnit XML Test Report',
    attachmentType: 'GeneralAttachment',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData),
  });

  if (!res.ok) throw new Error(`Failed to attach file: ${res.status} ${await res.text()}`);
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
  const url = `${baseUrl}/test/runs/${runId}/results?api-version=7.1-preview.6`;

  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch test results: ${res.status} ${text}`);
  }
    const data = await res.json();
  const results = Array.isArray(data.value)
  ? data.value.map(r => ({
      id: r.id,
      title: r.testCaseTitle
    }))
  : [];

console.log("Parsed Results:", results);
  return results;
}

async function addTestResults(runId, testCases, testPoints) {
  const url = `${baseUrl}/test/Runs/${runId}/results?api-version=7.1`;

  const payload = [];
  for (const point of testPoints) {
    const match = testCases.find(tc => tc.testName === point.testCase.name);
    if (match) {
      payload.push({
        id: point.id,
        outcome: match.status === 'fail' ? 'Failed' : match.status === 'pass' ? 'Passed' : 'NotExecuted',
        automatedTestName: match.testName,
        automatedTestType: 'Unit',
        testCaseTitle: match.testName,
        errorMessage: match.failureMessage,
        state:'Completed'
      });
    }
  }

  if (payload.length === 0) {
    console.warn('No matching test cases found for test points.');
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add test results: ${res.status} ${text}`);
  }
  return res.json();
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

(async () => {
  try {
    console.log('Parsing JUnit report...');
    const testCases = await parseJUnitTestCases(TEST_REPORT_FILE);

    console.log('Fetching test points...');
    const testPoints = await getTestPoints();
    const pointIds = testPoints.map(p => p.id);


    console.log('Creating test run...');
    const run = await createTestRun(pointIds);
    console.log(`Test run created: ID ${run.id}`);

    console.log('Updating test results...');
    await addTestResults(run.id, testCases, testPoints);

    console.log('Attaching JUnit report...');
    await addRunAttachment(run.id, TEST_REPORT_FILE);
    console.log('✅ JUnit report attached.');

    await completeTestRun(run.id);
    console.log('Test run updated successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
