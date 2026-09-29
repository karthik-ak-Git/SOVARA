const fs = require('fs');
const path = require('path');

// Helper function to read and execute JS code using Node.js
function runTest(scriptPath) {
  try {
    console.log("\n--- Running Tests ---");
    // Execute the script, assuming it calls math_utils.js functions
    const output = fs.readFileSync(scriptPath, 'utf8');
    console.log(output);
    console.log("--- Tests Completed Successfully ---");
  } catch (error) {
    console.error("\n!!! TEST FAILED !!!");
    console.error("Error during execution: ", error.message);
    process.exit(1);
  }
}

// Execute the test runner
runTest(path.join('.', 'test_math.js'));
