'use strict';

const redis = require('ioredis');
const natural = require('natural');
const metaphone = natural.Metaphone.process;
const stem = natural.PorterStemmer.stem;
const stopwords = natural.stopwords;
let redisClient;

const commands = {
  and: 'zinterstore',
  or: 'zunionstore'
};

exports.createSearch = function(namespace, client) {
  if (!namespace) {
    throw new Error('createSearch requires a namespace');
  }
  return new Search(namespace, client);
};

function Search(namespace, client) {
  this.namespace = namespace;
  redisClient = client || redis.createClient();
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
  var cmds = [];
  var tmpKeys = [];

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
          cmds.push([command, tmpKeyName, keys.length].concat(keys));
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
    cmds.push([commands.and, finalKey, tmpKeys.length].concat(tmpKeys));
  }

  var resultIndex = cmds.length;
  cmds.push(['zrevrange', finalKey, start, stop]);

  tmpKeys = tmpKeys.concat([finalKey]);
  tmpKeys.forEach(function(tmpKey) {
    if (tmpKey.indexOf(':temp') !== -1) {
      cmds.push(['zremrangebyrank', tmpKey, start, stop]);
    }
  });

  const ids = await redisClient.multi(cmds).exec();
  const errRes = ids[resultIndex];
  if (errRes[0]) {
    throw new Error(String(errRes[0]));
  }
  return errRes[1];
};

Search.prototype.count = async function (namespace) {
  return await redisClient.scard(`${namespace}:ids`);
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
  const indexValues = await redisClient.smembers(namespace + ':id:' + id + ':' + index);
  var multi = redisClient.multi();
  multi.del(namespace + ':id:' + id + ':' + index);

  indexValues.forEach(function(indexValue) {
    multi.zrem(namespace + ':' + index + ':' + indexValue + ':id', id);
  });

  return await multi.exec();
}

async function getIndices(namespace, id) {
  return await redisClient.smembers(namespace + ':id:' + id + ':indices');
}

async function indexData(namespace, data, id) {
  var cmds = [];
  for(var index in data) {
    if (data.hasOwnProperty(index)) {
      addIndexCommands(cmds, namespace, index, data[index], id);
    }
  }
  return await redisClient.multi(cmds).exec();
}

function addIndexCommands(cmds, namespace, index, indexValue, id) {
  if (!indexValue || !index || !id) {
    return;
  }
  if (index === 'content') {
    var words = toStem(stripStopWords(toWords(indexValue)));
    var counts = countWords(words);
    var map = metaphoneMap(words);
    var keys = Object.keys(map);

    keys.forEach(function(word) {
      cmds.push(['zadd', namespace + ':' + index + ':' + map[word] + ':id', counts[word], id]);
      cmds.push(['sadd', namespace + ':id:' + id + ':' + index, map[word]]);
    });
  } else {
    cmds.push(['zadd', namespace + ':' + index + ':' + indexValue + ':id', indexValue, id]);
    cmds.push(['sadd', namespace + ':id:' + id + ':' + index, indexValue]);
  }
  cmds.push(['sadd', namespace + ':id:' + id + ':indices', index]);
  cmds.push(['sadd', namespace + ':ids', id]);
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

