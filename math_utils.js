function average(numbers) {
  if (numbers.length === 0) {
    return 0;
  }
  var sum = 0;
  for (var i = 0; i < numbers.length; i++) {
    sum += numbers[i];
  }
  var result = sum / numbers.length;
  return result;
}