#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

// -----------------------------
// Environment variables
// -----------------------------
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

// -----------------------------
// Auth header
// -----------------------------
const authHeader = () => {
  const token = Buffer.from(`:${ADO_PAT}`).toString('base64');
  return `Basic ${token}`;
};

// -----------------------------
// Base API URL
// -----------------------------
const baseUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/test`;

// -----------------------------
// Parse JUnit XML report
// -----------------------------
async function parseJUnitReport(filePath) {
  const xml = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const result = await parseStringPromise(xml);
  const testsuites = result.testsuites.testsuite || [];

  return testsuites.map((suite) => ({
    name: suite.$.name,
    errors: parseInt(suite.$.errors, 10),
    failures: parseInt(suite.$.failures, 10),
    skipped: parseInt(suite.$.skipped, 10),
    tests: parseInt(suite.$.tests, 10),
    time: parseFloat(suite.$.time),
  }));
}

// -----------------------------
// Create Test Run with fixed pointIds [1,2]
// -----------------------------
async function createTestRun() {
  const url = `${baseUrl}/runs?api-version=7.1-preview.3`;
  const body = {
    name: `Automated Test Run - ${new Date().toISOString()}`,
    plan: { id: parseInt(ADO_TEST_PLAN_ID, 10) },
    ...(ADO_TEST_SUITE_ID ? { suite: { id: parseInt(ADO_TEST_SUITE_ID, 10) } } : {}),
    automated: true,
    pointIds: [1, 2], // Fixed point IDs
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

// -----------------------------
// Update test results for run
// -----------------------------
async function updateTestResults(runId, suites) {
  // Fetch result IDs from run
  const resultsRes = await fetch(`${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`, {
    headers: { 'Authorization': authHeader() }
  });
  const resultsData = await resultsRes.json();
  const results = resultsData.value;

  // Map suites to results
  const payload = results.map((r, i) => ({
    id: r.id,
    outcome:
      suites[i % suites.length].failures > 0 ? 'Failed' :
      suites[i % suites.length].skipped > 0 ? 'NotExecuted' : 'Passed',
    automatedTestName: suites[i % suites.length].name,
    automatedTestType:'Unit',
    comment: `Updated via pipeline for suite ${suites[i % suites.length].name}`,
  }));

  const res = await fetch(`${baseUrl}/runs/${runId}/results?api-version=7.1-preview.6`, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update test results: ${res.status} ${text}`);
  }

  return res.json();
}

// -----------------------------
// Complete Test Run
// -----------------------------
async function completeTestRun(runId) {
  const url = `${baseUrl}/runs/${runId}?api-version=7.1-preview.3`;
  const body = { state: 'Completed', comment: 'Run finished via pipeline' };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete test run: ${res.status} ${text}`);
  }

  return res.json();
}

// -----------------------------
// Main Execution
// -----------------------------
(async () => {
  try {
    console.log('Parsing JUnit report...');
    const suites = await parseJUnitReport(TEST_REPORT_FILE);

    console.log('Creating test run with pointIds [1,2]...');
    const run = await createTestRun();
    console.log(`Test run created: ID ${run.id}`);

    console.log(`Update result run created: ID ${run.id}`);
    await updateTestResults(run.id, suites);

    console.log(`Complete: ID ${run.id}`);
    await completeTestRun(run.id);

       console.log('Test results uploaded and run completed successfully!');
  } catch (err) {
    console.error('Error updating Azure DevOps Test Plan:', err);
    process.exit(1);
  }
})();
