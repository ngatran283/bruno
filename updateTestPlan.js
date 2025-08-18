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
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// Read and parse JUnit report
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];

 // const payload =  testsuites.map((suite) => ({
   // name: suite.$.name,
    //errors: parseInt(suite.$.errors, 10),
    //failures: parseInt(suite.$.failures, 10),
    //skipped: parseInt(suite.$.skipped, 10),
    //tests: parseInt(suite.$.tests, 10),
  //  time: parseFloat(suite.$.time),
//  }));
const payload = results.map((suite) => {
  const outcome =
    suite.failures > 0 ? 'Failed' :
    suite.skipped > 0 ? 'NotExecuted' : 'Passed';

  // Detailed logging
  console.log('-----------------------------------------');
  console.log(`Test Suite Name : ${suite.name}`);
  console.log(`Tests           : ${suite.tests}`);
  console.log(`Failures        : ${suite.failures}`);
  console.log(`Errors          : ${suite.errors}`);
  console.log(`Skipped         : ${suite.skipped}`);
  console.log(`Time (s)        : ${suite.time}`);
  console.log(`Mapped Outcome  : ${outcome}`);
  console.log('-----------------------------------------');

  return {
    testCaseTitle: suite.name,
    outcome: outcome,
    automatedTestName: suite.name,
    automatedTestType: 'Unit',
  };
});
}

// Create a new test run
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.2`;
  const body = {
    name: `Bruno Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    // Optional: include suite
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
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

// Add test results to the test run
async function addTestResults(runId, results) {
  const url = `${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`;

  const payload = results.map((suite) => ({
    testCaseTitle: suite.name,
    outcome:
      suite.failures > 0 ? 'Failed' :
      suite.skipped > 0 ? 'NotExecuted' : 'Passed',
    automatedTestName: suite.name,
    automatedTestType: 'Unit',
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
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

    console.log('Test results uploaded successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
