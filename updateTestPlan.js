const fs = require('fs');
const xml2js = require('xml2js');
const fetch = require('node-fetch');

const jUnitFile = process.env.TEST_REPORT_FILE || 'junit-report.xml';
const org = process.env.ADO_ORG;
const project = process.env.ADO_PROJECT;
const token = process.env.ADO_PAT;
const planId = process.env.ADO_TEST_PLAN_ID;
const suiteId = process.env.ADO_TEST_SUITE_ID; // Optional: specific suite

if (!org || !project || !token || !planId) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

const parser = new xml2js.Parser();
const xml = fs.readFileSync(jUnitFile, 'utf-8');

function authHeader() {
  return 'Basic ' + Buffer.from(':' + token).toString('base64');
}

async function getTestCases() {
  let url = `https://dev.azure.com/${org}/${project}/_apis/test/plans/${planId}/suites/${suiteId}/testcases?api-version=7.1-preview.1`;
  const response = await fetch(url, { headers: { 'Authorization': authHeader() } });
  const data = await response.json();
  return data.value || [];
}

async function createTestRun() {
  const url = `https://dev.azure.com/${org}/${project}/_apis/test/runs?api-version=7.1-preview.1`;
  const body = {
    name: `Bruno API Test Run - ${new Date().toISOString()}`,
    plan: { id: planId },
    automated: true
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify(body)
  });
  return await response.json();
}

async function addTestResults(runId, results) {
  const url = `https://dev.azure.com/${org}/${project}/_apis/test/runs/${runId}/results?api-version=7.1-preview.1`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify(results)
  });
  return await response.json();
}

parser.parseString(xml, async (err, result) => {
  if (err) {
    console.error('Failed to parse JUnit XML:', err);
    process.exit(1);
  }

  const testSuites = result.testsuites.testsuite || [];
  if (!testSuites.length) {
    console.log('No test suites found in JUnit report.');
    return;
  }

  const testCasesInPlan = await getTestCases();

  // Map Bruno test suite names to Test Case IDs
  const results = [];
  testSuites.forEach(suite => {
    const matchingTest = testCasesInPlan.find(tc => tc.testCase.name === suite.$.name);
    if (matchingTest) {
      const outcome = suite.$.failures === '0' ? 'Passed' : 'Failed';
      results.push({
        testCase: { id: matchingTest.testCase.id },
        outcome: outcome,
        durationInMs: parseFloat(suite.$.time || 0) * 1000
      });
    }
  });

  if (!results.length) {
    console.log('No matching test cases found in Test Plan.');
    return;
  }

  const run = await createTestRun();
  console.log('Created Test Run:', run.id);

  const addedResults = await addTestResults(run.id, results);
  console.log('Added Test Results:', addedResults.count);
});
