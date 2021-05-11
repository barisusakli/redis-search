
'use strict';

/* globals before, after, describe, it */

const redisSearch = require('../index');
const assert = require('assert');

const postSearch = redisSearch.createSearch('mypostsearch');

before(async function() {
  await Promise.all([
    postSearch.index({content: 'ruby emerald', uid: 5, cid: 1}, 1),
    postSearch.index({content: 'emerald orange emerald', uid: 5, cid: 2}, 2),
    postSearch.index({content: 'cucumber apple orange', uid: 4, cid: 2}, 3),
    postSearch.index({content: 'ORANGE apple pear', uid: 5, cid: 4}, 4),
    postSearch.index({content: 'dog cat', uid: 6, cid: 4}, 5),
  ]);
});


describe('query', function() {
  it('should find the correct ids', async function() {
    const ids = await postSearch.query({
      matchWords: 'any',
      query: { content: 'apple orange', uid: 5 },
    });

    assert.strictEqual(ids.length, 2);
    assert(ids.includes('2'));
    assert(ids.includes('4'));
  });

  it('should return empty', async function () {
    const ids = await postSearch.query({ query: {uid: 5, content: 'apple orange', cid: 123 } });
    assert.strictEqual(ids.length, 0);
  });

  it('should return 1', async function () {
    const ids = await postSearch.query({ query: { uid: 5, content: 'emerald', cid: 1 } } );
    assert.strictEqual(ids.length, 1);
    assert.strictEqual(ids[0], '1');
  });

  it('should return all the ids with uid=5', async function () {
    const ids = await postSearch.query({ query: { uid: 5 }});
    assert.strictEqual(ids.length, 3);
    assert(ids.includes('1'));
    assert(ids.includes('2'));
    assert(ids.includes('4'));
  });

  it('should only return 4', async function () {
    const ids = await postSearch.query({
      matchWords: 'any',
      query: { content: 'ruby pear', cid: 4 }
    });
    assert.strictEqual(ids.length, 1);
    assert(ids.includes('4'));
  });

  it('should limit the results to 2', async function () {
    const ids = await postSearch.query({ query: { uid: 5 } }, 0, 1);
    assert.strictEqual(ids.length, 2);
  });

  it('should return the correct ids when an array is passed in', async function () {
    const ids = await postSearch.query({ query: { cid: [2, 4] } });
    assert.strictEqual(ids.length, 4);
    assert(ids.includes('2'));
    assert(ids.includes('3'));
    assert(ids.includes('4'));
    assert(ids.includes('5'));
  });

  it('should return the correct ids when an array is passed in', async function () {
    const ids = await postSearch.query({
      query: {
        cid: [2, 4], content: 'orange', uid: 4
      }
    });

    assert.strictEqual(ids.length, 1);
    assert(ids.includes('3'));
  });

  it('should find the match when query is upper case', async function () {
    const ids = await postSearch.query({ query: { content: 'CUCUMBER' } })
    assert.strictEqual(ids.length, 1);
    assert(ids.includes('3'));
  });
});


after(async function () {
  await Promise.all([
    postSearch.remove(1),
    postSearch.remove(2),
    postSearch.remove(3),
    postSearch.remove(4),
    postSearch.remove(5),
  ]);
});
