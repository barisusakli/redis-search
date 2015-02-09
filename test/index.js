
'use strict';

/* globals before, after, describe, it */

var redisSearch = require('../index');
var async = require('async');
var assert = require('assert');

var postSearch = redisSearch.createSearch('mypostsearch');

before(function(done) {
  async.parallel([
    function(next) {
      postSearch.index({content: 'ruby emerald', uid: 5, cid: 1}, 1, next);
    },
    function(next) {
      postSearch.index({content: 'emerald orange emerald', uid: 5, cid: 2}, 2, next);
    },
    function(next) {
      postSearch.index({content: 'cucumber apple orange', uid: 4, cid: 2}, 3, next);
    },
    function(next) {
      postSearch.index({content: 'ORANGE apple pear', uid: 5, cid: 4}, 4, next);
    },
    function(next) {
      postSearch.index({content: 'dog cat', uid: 6, cid: 4}, 5, next);
    }
  ], done);
});


describe('query', function() {
  it('should find the correct ids', function(done) {
    postSearch.query({content: 'apple orange', uid: 5}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 2);
      assert.notEqual(ids.indexOf('2'), -1);
      assert.notEqual(ids.indexOf('4'), -1);
      done();
    });
  });

  it('should return empty', function(done) {
    postSearch.query({uid: 5, content: 'apple orange', cid: 123}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 0);
      done();
    });
  });

  it('should return 1', function(done) {
    postSearch.query({uid: 5, content: 'emerald', cid: 1}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 1);
      assert.equal(ids[0], 1);
      done();
    });
  });

  it('should return all the ids with uid=5', function(done) {
    postSearch.query({uid: 5}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 3);
      assert.notEqual(ids.indexOf('1'), -1);
      assert.notEqual(ids.indexOf('2'), -1);
      assert.notEqual(ids.indexOf('4'), -1);
      done();
    });
  });

  it('should return return 4', function(done) {
    postSearch.query({content: 'ruby pear', cid: 4}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 1);
      assert.notEqual(ids.indexOf('4'), -1);
      done();
    });
  });

  it('should limit the results to 2', function(done) {
    postSearch.query({uid: 5}, 0, 1, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 2);
      done();
    });
  });

  it('should return the correct ids when an array is passed in', function(done) {
    postSearch.query({cid: [2, 4]}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 4);
      assert.notEqual(ids.indexOf('2'), -1);
      assert.notEqual(ids.indexOf('3'), -1);
      assert.notEqual(ids.indexOf('4'), -1);
      assert.notEqual(ids.indexOf('5'), -1);
      done();
    });
  });

  it('should return the correct ids when an array is passed in', function(done) {
    postSearch.query({cid: [2, 4], content: 'orange', uid: 4}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 1);
      assert.notEqual(ids.indexOf('3'), -1);
      done();
    });
  });

  it('should find the match when query is upper case', function(done) {
    postSearch.query({content: 'CUCUMBER'}, function(err, ids) {
      assert.ifError(err);
      assert.equal(ids.length, 1);
      assert.notEqual(ids.indexOf('3'), -1);
      done();
    });
  })

});


after(function(done) {
  async.parallel([
    function(next) {
      postSearch.remove(1, next);
    },
    function(next) {
      postSearch.remove(2, next);
    },
    function(next) {
      postSearch.remove(3, next);
    },
    function(next) {
      postSearch.remove(4, next);
    },
    function(next) {
      postSearch.remove(5, next);
    }
  ], done);
});




