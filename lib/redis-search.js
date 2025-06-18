'use strict';

const { createClient } = require('redis');
const natural = require('natural');
const metaphone = natural.Metaphone.process;
const stem = natural.PorterStemmer.stem;
const stopwords = natural.stopwords;
let redisClient;

const commands = {
  and: 'zInterStore',
  or: 'zUnionStore'
};

exports.createSearch = function(namespace, client) {
  if (!namespace) {
    throw new Error('createSearch requires a namespace');
  }
  return new Search(namespace, client);
};

function Search(namespace, client) {
  this.namespace = namespace;
  if (client) {
    redisClient = client;
  } else {
    client = createClient();
    client.on('error', (err) => {
      console.error('Redis error:', err);
    });
    client.connect().catch(err => {
      console.error('Error connecting to Redis:', err);
    });
  }
  redisClient = client;
}

Search.prototype.index = async function(data, id) {
  var namespace = this.namespace;
  if (!namespace) {
    throw new Error('index needs a namespace');
  }

  await indexData(namespace, data, id);
};

Search.prototype.query = async function (data, start, stop) {
  var namespace = this.namespace;
  start = start || 0;
  stop = stop || -1;

  var keyMap = getKeys(namespace, data.query);
  var tmpKeys = [];
  let resultIndex = 0;
  var multi = redisClient.multi();

  for(var index in keyMap) {
    if (keyMap.hasOwnProperty(index)) {
      var keys = keyMap[index];
      if (Array.isArray(keys)) {
        if (keys.length === 1) {
          tmpKeys.push(keys[0]);
        } else if (keys.length > 1) {
          var tmpKeyName = namespace + ':' + index + ':temp';
          tmpKeys.push(tmpKeyName);
          var command = commands.or;
          if (index === 'content') {
            command = commands.and;
            if (data.matchWords === 'any') {
              command = commands.or;
            }
          }
          multi[command](tmpKeyName, keys);
          resultIndex ++;
        }
      }
    }
  }

  if (!tmpKeys.length) {
    return [];
  }

  var finalKey = namespace + ':tempFinal';
  if (tmpKeys.length === 1) {
    finalKey = tmpKeys[0];
  } else {
    multi[commands.and](finalKey, tmpKeys);
    resultIndex ++;
  }

  multi.zRange(finalKey, start, stop, { REV: true });

  tmpKeys = tmpKeys.concat([finalKey]);
  tmpKeys.forEach(function(tmpKey) {
    if (tmpKey.indexOf(':temp') !== -1) {
      multi.zRemRangeByRank(tmpKey, start, stop);
    }
  });

  const ids = await multi.exec();
  return ids[resultIndex];
};

Search.prototype.count = async function (namespace) {
  return await redisClient.sCard(`${namespace}:ids`);
};

function getKeys(namespace, data) {
  var keys = {};
  for (var index in data) {
    if (data.hasOwnProperty(index)) {
      keys[index] = indexToSets(namespace, index, data);
    }
  }
  return keys;
}

function indexToSets(namespace, index, data) {
  var sets = [];
  if (index === 'content') {
    if (!data.content) {
      return keys;
    }
    var words = toStem(stripStopWords(toWords(data.content)));
    var keys = metaphoneKeys(namespace, index, words);
    sets = sets.concat(keys);
  } else {
    if (Array.isArray(data[index])) {
      data[index].forEach(function(indexValue) {
        sets.push(namespace + ':' + index + ':' + indexValue + ':id');
      });
    } else {
      sets.push(namespace + ':' + index + ':' + data[index] + ':id');
    }
  }

  return sets;
}

Search.prototype.remove = async function(id) {
  var namespace = this.namespace;

  const indices = await getIndices(namespace, id);
  await Promise.all(indices.map(index => removeIndex(namespace, id, index)));
  await redisClient.del(namespace + ':id:' + id + ':indices');
  return this;
};

async function removeIndex(namespace, id, index) {
  const indexValues = await redisClient.sMembers(namespace + ':id:' + id + ':' + index);
  var multi = redisClient.multi();
  multi.del(namespace + ':id:' + id + ':' + index);

  indexValues.forEach(function(indexValue) {
    multi.zRem(namespace + ':' + index + ':' + indexValue + ':id', String(id));
  });

  return await multi.exec();
}

async function getIndices(namespace, id) {
  return await redisClient.sMembers(namespace + ':id:' + id + ':indices');
}

async function indexData(namespace, data, id) {
  const multi = redisClient.multi();
  for(var index in data) {
    if (data.hasOwnProperty(index)) {
      addIndexCommands(multi, namespace, index, data[index], id);
    }
  }
  return await multi.exec();
}

function addIndexCommands(multi, namespace, index, indexValue, id) {
  if (!indexValue || !index || !id) {
    return;
  }
  if (index === 'content') {
    var words = toStem(stripStopWords(toWords(indexValue)));
    var counts = countWords(words);
    var map = metaphoneMap(words);
    var keys = Object.keys(map);

    keys.forEach(function(word) {
      multi.zAdd(namespace + ':' + index + ':' + map[word] + ':id', { score: counts[word], value: String(id) });
      multi.sAdd(namespace + ':id:' + id + ':' + index, String(map[word]));
    });
  } else {
    multi.zAdd(namespace + ':' + index + ':' + indexValue + ':id', { score: indexValue, value: String(id) });
    multi.sAdd(namespace + ':id:' + id + ':' + index, String(indexValue));
  }
  multi.sAdd(namespace + ':id:' + id + ':indices', String(index));
  multi.sAdd(namespace + ':ids', String(id));
}

function toWords(content) {
  return String(content).match(/[\p{L}_]+/ug);
}

function metaphoneKeys(key, index, words) {
  return metaphoneArray(words).map(function(c) {
    return key + ':' + index + ':' + c + ':id';
  });
}

function metaphoneArray(words) {
  var arr = [];
  var constant;

  if (!words) {
    return arr;
  }

  for (var i = 0, len = words.length; i < len; ++i) {
    constant = metaphone(words[i]);
    if (!~arr.indexOf(constant)) {
      arr.push(constant);
    }
  }

  return arr;
}

function metaphoneMap(words) {
  var obj = {};
  if (!words) {
    return obj;
  }
  for (var i = 0, len = words.length; i < len; ++i) {
    obj[words[i]] = metaphone(words[i]);
  }
  return obj;
}

function toStem(words) {
  var ret = [];
  if (!words) {
    return ret;
  }
  for (var i = 0, len = words.length; i < len; ++i) {
    ret.push(stem(words[i]));
  }
  return ret;
}

function stripStopWords(words){
  var ret = [];
  if (!words) {
    return ret;
  }
  for (var i = 0, len = words.length; i < len; ++i) {
    if (stopwords.indexOf(words[i]) !== -1) {
      continue;
    }
    ret.push(words[i]);
  }
  return ret;
}

function countWords(words) {
  var obj = {};
  if (!words) {
    return obj;
  }
  for (var i = 0, len = words.length; i < len; ++i) {
    obj[words[i]] = (obj[words[i]] || 0) + 1;
  }
  return obj;
}

