import assert from 'node:assert';
import { average } from './math_utils.js';

console.log('Running math_utils tests...');

try {
  // Test 1: Standard array
  assert.strictEqual(average([2, 4, 6]), 4, 'Average of [2, 4, 6] should be 4');
  console.log('✓ Test 1 passed: average([2, 4, 6]) === 4');

  // Test 2: Single element
  assert.strictEqual(average([10]), 10, 'Average of [10] should be 10');
  console.log('✓ Test 2 passed: average([10]) === 10');

  // Test 3: Empty array should safely return 0 without division by zero
  const emptyResult = average([]);
  assert.strictEqual(Number.isFinite(emptyResult), true, 'Result for empty array must be finite');
  assert.strictEqual(emptyResult, 0, 'Average of [] should safely return 0');
  console.log('✓ Test 3 passed: average([]) === 0');

  console.log('\nAll tests passed successfully!');
  process.exit(0);
} catch (err) {
  console.error('\n❌ Test Failure Detected:');
  console.error(err.message);
  process.exit(1);
}
