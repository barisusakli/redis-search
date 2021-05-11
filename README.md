# redis-search
Index and search data in redis

Inspired by https://github.com/tj/reds

#### Differences :

   query on extra fields

#### How to use :

```
var redisSearch = require('redisSearch');

var postSearch = redisSearch.createSearch('mypostsearch', [redisClient]);
```

#### Indexing: 

`postSearch.index(data, id, callback);`

```
// index some stuff, the string field must be named `content` others can be anything
postSearch.index({content: 'ruby emerald', uid: 5, cid: 1}, 1, next);
postSearch.index({content: 'emerald orange emerald', uid: 5, cid: 2}, 2, next);
postSearch.index({content: 'cucumber apple orange', uid: 4, cid: 2}, 3, next);
postSearch.index({content: 'orange apple pear', uid: 5, cid: 4}, 4, next);
postSearch.index({content: 'dog cat', uid: 6, cid: 4}, 5, next);
```

#### Search 

`postSearch.query(data, callback);`

```
postSearch.query({ query: { content: "orange", uid: 5, cid: 2} }, function(err, ids) {
    console.log(ids); // ["2"]
});
```

#### Remove from index: 

`postSearch.remove(id);`

```
postSearch.remove(3);
```


#### Other examples:

```
// search for ids where content contains `orange` and cid is 2 or 4
postSearch.query({ query: { content: "orange", cid: [2,4] } } , callback);

// search for ids where uid is 5 and return 3 results
postSearch.query({ query: { uid: 5 } }, 0, 2);
```

