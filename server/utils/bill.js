'use strict';

var fs = require('fs');
var tesseract = require('node-tesseract');
var Promise = require('bluebird');
var costRegex = require('./regex').cost();

Promise.promisifyAll(fs);

/**
 * Initial function to start parsing bill data.
 * @param  {String}  path     Path to bill image
 * @param  {JPEG}    file     Uploaded bill image
 * @param  {String}  billName File name of uploaded receipt
 */
exports.parse = function(path, file, billName) {
  return new Promise(function(resolve, reject) {
    exports.readFile(file)
    .then(function(data) {
      return writeFile(path, data);
    })
    .then(function() {
      return exports.process(path, billName);
    })
    .then(function(text) {
      resolve(text);
    })
    .catch(function(err) {
      reject(err);
    })
    .done();
  });
};

/**
 * Reads bill image file from Formidable.
 * @param  {JPEG}    file Uploaded bill image
 * @return {Promise}      Returns parsed bill items or error
 */
exports.readFile = function(file) {
  return fs.readFileAsync(file)
  .then(function(data) {
    return data;
  })
  .catch(function(err) {
    return err;
  });
};

/**
 * Writes to bill image to disk.
 * @param   {String}   path   Path to bill image
 * @param   {JPEG}     file   Uploaded bill image
 * @return  {Promise}         Returns parsed bill items or error
 */
var writeFile = function(path, file) {
  return fs.writeFileAsync(path, file)
  .then(function() {
    return;
  })
  .catch(function(err) {
    return err;
  });
};

/**
 * Process bill items to JSON object.
 * @param  {JPEG}    file Uploaded bill image
 * @return {Promise}      Returns parsed bill items or error
 */
exports.process = function(path, billName) {
  return new Promise(function(resolve, reject) {
    tesseract.process(path, function(err, text) {
      if (err) {
        reject(err);
      } else {
        console.log('/**');
        console.log(' * //////////////');
        console.log(' * // raw text //');
        console.log(' * //////////////');
        var rawText = text.split('\n');
        rawText.forEach(function(line) {
          console.log(' * ' + line);
        });
        console.log(' */');
        console.log('\n');

        var bill = require('../api/bill/model').billModel();
        bill.billName = billName;
        bill.diners[billName] = [];
        
        exports.postProcess(bill, text);
        exports.isValid(bill);
        resolve(bill);
      }
    });
  });
};

/**
 * Initializes bill processing. Passes the bill object 
 * through a series of decorators to find items and totals.
 * @param  {String} text Bill object
 * @param  {Array}  item Line item of bill text
 * @param  {Float}  cost Cost of line item
 */
exports.postProcess = function(bill, text) {
  var receipt = text.split('\n');
  
  for (var i = 0; i < receipt.length; i++) {
    var item = receipt[i].split(' ');
    exports.spaceToDecimal(item);

    var cost = item.pop();
    
    // continue if line doesn't have a cost
    if (cost.search(costRegex) < 0) {
      continue;
    }

    cost = +parseFloat(cost).toFixed(2);
    // cost = Math.floor(cost * 100) / 100;

    // assume ordered item if first element is a number
    if (!isNaN(item[0])) {
      exports.parseItems(bill, item, cost);
      continue;
    } 

    // assume total if cost and first element is not a number 
    exports.parseTotals(bill, item, cost);
  }

  exports.checkTotals(bill);

  return bill;
};

/**
 * Decorator to replace empty space with decimals in a valid
 * cost value (if needed).
 * @param  {Array}  item  Single line item of receipt.
 */
exports.spaceToDecimal = function(item) {
  var length = item.length;
  var cost = item[length - 2] + '.' + item[length - 1];
  
  if (cost.search(costRegex) > -1) {
    item[length - 2] = cost;
    item.pop();
  }
}

/**
 * Decorator to parse receipt for ordered items.
 * @param {Object} bill Bill object
 * @param {Array}  item Line item of bill text
 * @param {Float}  cost Cost of line item
 */
exports.parseItems = function(bill, item, cost) {
  var quanity = parseInt(item.shift());
  var billName = bill.billName;

  for (var i = 0; i < quanity; i++) {
    bill.receipt.items.push({
      item: item.join(' '),
      cost: cost / quanity
    });

    // push false value for each item
    bill.diners[billName].push(false);
  }
};

/**
 * Decorator to parse receipt for subTotal, tax, and total.
 * @param {Object} bill Bill object
 * @param {Array}  item Line item of bill text
 * @param {Float}  cost Cost of line item
 */
exports.parseTotals = function(bill, item, cost) {
  var itemString = item.join('').toLowerCase();
  
  // check for 'sub' must come before 'total'
  if (itemString.indexOf('sub') !== -1) {
    bill.receipt.subTotal = cost;
  }

  if (itemString.indexOf('tax') !== -1) {
    bill.receipt.tax = cost;
  }

  if (itemString.indexOf('total') !== -1) {
    bill.receipt.total = cost;
  }
};

/**
 * Sanity check for totals before returning the constructed bill 
 * object. If the raw text is too grabled for a clean parse, bill
 * will be an empty object.
 * @param {Object} bill Bill object
 */
exports.checkTotals = function(bill) {
  var receipt = bill.receipt;

  // derive total from subtoal and tax if no total
  if (receipt.subTotal && receipt.tax && !receipt.total) {
    receipt.total = Math.floor((receipt.subTotal + receipt.tax) * 100) / 100;
  }

  // TODO: better total handling
  // if (receipt.subTotal + receipt.tax !== receipt.total) {
  //   
  // }

  // if (receipt.total - receipt.tax !== receipt.subTotal) {
  //   
  // }
};

exports.isValid = function(bill) {
  var receipt = bill.receipt;
  var subTotal = receipt.items.reduce(function(prev, curr) {
    return prev + curr.cost;
  }, 0);

  // TODO: better bad receipt handling
  if (!subTotal || Math.abs(subTotal - receipt.subTotal) > .05) {
    for (var prop in bill) {
      delete bill[prop];
    }
  }
}