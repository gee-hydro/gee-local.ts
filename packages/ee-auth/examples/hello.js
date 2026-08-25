const ee = require('ee-auth');
ee.Initialize('gee-hydro');

var x = ee.Number(1).add(41);
var img = ee.Image(1);
print(x);
print(img);
print(x, img);
