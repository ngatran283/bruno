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
const BUILD_ID = process.env.BUILD_BUILDID;
const TEST_REPORT_FILE = process.env.TEST_REPORT_FILE;

if (!ADO_ORG || !ADO_PROJECT || !ADO_PAT || !ADO_TEST_PLAN_ID || !TEST_REPORT_FILE) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

// Basic auth header
const authHeader = () => `Basic ${Buffer.from(`:${ADO_PAT}`).toString('base64')}`;

// Base URL
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Parse JUnit XML
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

// Create test run with hardcoded points
async function createTestRun(pointIds) {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Automated Run ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    pointIds,
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

// Add test results to the run
async function addTestResults(runId, pointIds, suites) {
  const url = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;

  const payload = pointIds.map((id, i) => {
    const suite = suites[i % suites.length];
    return {
      id, // pointId
      outcome:
        suite.failures > 0 ? 'Failed' :
        suite.skipped > 0 ? 'NotExecuted' : 'Passed',
      automatedTestName: suite.name,
      automatedTestType: 'Unit',
      testCaseTitle: suite.name,
    };
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add test results: ${res.status} ${text}`);
  }

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

  return res.json();
}

// Main execution
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const suites = await parseJUnitReport(TEST_REPORT_FILE);
    console.log('Test suites found:', suites.length);

    // Hardcoded points
    const pointIds = [1, 2];
    console.log('Creating test run with points:', pointIds);
    const run = await createTestRun(pointIds);

    console.log(`Test run created: ID ${run.id}`);
    console.log('Uploading test results...');
    await addTestResults(run.id, pointIds, suites);

    console.log('Completing test run...');
    await completeTestRun(run.id);

    console.log('Test run completed successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
