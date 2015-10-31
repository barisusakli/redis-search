'use strict';

var redis = require('redis');
var async = require('async');
var natural = require('natural');
var metaphone = natural.Metaphone.process;
var stem = natural.PorterStemmer.stem;
var stopwords = natural.stopwords;
var redisClient;

function noop() {}

var commands = {
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

Search.prototype.index = function(data, id, callback) {
  callback = callback || noop;

  var namespace = this.namespace;
  if (!namespace) {
    return callback(new Error('index needs a namespace'));
  }

  indexData(namespace, data, id, callback);
};

Search.prototype.query = function(data, start, stop, callback) {
  if (typeof start === 'function') {
    callback = start;
    start = 0;
  }

  var namespace = this.namespace;
  start = start || 0;
  stop = stop || -1;

  var keyMap = getKeys(namespace, data);
  var cmds = [];
  var tmpKeys = [];

  for(var index in keyMap) {
    if (keyMap.hasOwnProperty(index)) {
      var keys = keyMap[index];
      if (keys.length === 1) {
        tmpKeys.push(keys[0]);
      } else if (keys.length > 1) {
        var tmpKeyName = namespace + ':' + index + ':temp';
        tmpKeys.push(tmpKeyName);
        var command = commands.or;
        if (index === 'content' && data.content.startsWith('"') && data.content.endsWith('"')) {
          command = commands.and;
        }
        cmds.push([command, tmpKeyName, keys.length].concat(keys));
      }
    }
  }

  if (!tmpKeys.length) {
    return callback(null, []);
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

  redisClient.multi(cmds).exec(function(err, ids) {
    if (err) {
      return callback(err);
    }
    callback(null, ids[resultIndex]);
  });
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

Search.prototype.remove = function(id, callback) {
  callback = callback || noop;
  var namespace = this.namespace;

  async.waterfall([
    function(next) {
      getIndices(namespace, id, next);
    },
    function(indices, next) {
      async.each(indices, function(index, next) {
        removeIndex(namespace, id, index, next);
      }, next);
    }
  ], function(err) {
    if (err) {
      return callback(err);
    }
    redisClient.del(namespace + ':id:' + id + ':indices', callback);
  });

  return this;
};

function removeIndex(namespace, id, index, callback) {
  redisClient.smembers(namespace + ':id:' + id + ':' + index, function(err, indexValues) {
    if (err) {
      return callback(err);
    }

    var multi = redisClient.multi();
    multi.del(namespace + ':id:' + id + ':' + index);

    indexValues.forEach(function(indexValue) {
      multi.zrem(namespace + ':' + index + ':' + indexValue + ':id', id);
    });

    multi.exec(callback);
  });
}

function getIndices(namespace, id, callback) {
  redisClient.smembers(namespace + ':id:' + id + ':indices', callback);
}

function indexData(namespace, data, id, callback) {
  var cmds = [];
  for(var index in data) {
    if (data.hasOwnProperty(index)) {
      addIndexCommands(cmds, namespace, index, data[index], id);
    }
  }
  redisClient.multi(cmds).exec(callback);
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
}

function toWords(content) {
  return String(content).match(/\w+/g);
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

