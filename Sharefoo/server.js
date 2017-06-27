var express = require('express')
    , bodyParser = require('body-parser')
    , expressValidator = require('express-validator')
    , AWS = require('aws-sdk')
    , redis = require('redis')
    , Sequelize = require('sequelize')
    , moment = require('moment')
    , http = require('http')
    , fs = require('fs')
    , app = express()
    , server = http.createServer(app)
    , dynamodb = new AWS.DynamoDB({ region: 'ap-northeast-1' });

var redisEndpoint = {
    host: 'ticketredis.aurjbh.0001.apne1.cache.amazonaws.com',
    port : 6379
};

var rdsEndpoint = {
    host: 'photo007.c6s70yxmnndr.ap-northeast-1.rds.amazonaws.com',
    port: 3306
};

var dynamoDbTable = 'SharfooGameLog';

var redisClient = redis.createClient(redisEndpoint.port, redisEndpoint.host);

var sequelize = new Sequelize('Photo007DB', 'admin', 'Fletter01', {
    host: rdsEndpoint.host,
    port: rdsEndpoint.port
});

var User = sequelize.define('User', {
    userId: { type: Sequelize.STRING, allowNull: false, unique: true },
    //password: Sequelize.STRING,
    topScore: Sequelize.INTEGER,
    coin: Sequelize.INTEGER,
    itemSlot1: Sequelize.STRING,
    itemSlot2: Sequelize.STRING,
    itemSlot3: Sequelize.STRING
});

User.count().error(function (error) {
    if (error.code == 'ER_NO_SUCH_TABLE') {
        sequelize.sync().success(function () {
            User.create({
                userId: 'jonh',
                topScore: 0,
                coin: 1000,
            });
            User.create({
                userId: 'maria',
                topScore: 0,
                coin: 1000,
            });
        });
    }
});

var itemTable = {
    '101': { name: 'Bomb', price: { coin: '100' } },
    '102': { name: 'Time Bonus', price: { coin: '150' } }
};

app.use(bodyParser.urlencoded());
app.use(bodyParser.json());
app.use(expressValidator());

function writeLog(action, data) {
    var params = {
        Item: {
            action: { S: action },
            date: { S: moment().format('YYYY-MM-DD HH:mm:ss') }
        },
        TableName: dynamoDbTable
    };
    for (var key in data) {
        var attribute = data[key];
        if (isNaN(attribute))
            params.Item[key] = { S: attribute };
        else
            params.Item[key] = { N: String(attribute) };
    }

    dynamodb.putItem(params, function (err, data) { console.log(err) });
}

//ELB 로드 밸런스 헬스 체크용
app.get(['/', '/index.html'], function (req, res) {
    res.send();
});

app.get('/users/:userId', function (req, res) {
    req.assert('userId').notEmpty();
    var errors = req.validationErrors();
    if (errors) {
        res.send({ error: -1, data: errors });
        return;
    }

    var userId = req.params.userId;

    User.find({ where: { userId: userId } }).success(function (user) {
        var data = {};
        data.userId = user.userId;
        data.topScore = user.topScore;
        data.coin = user.coin;
        data.itemSlot1 = user.itemSlot1;
        data.itemSlot2 = user.itemSlot2;
        data.itemSlot3 = user.itemSlot3;

        res.send({ error: '', data: data });
    }).error(function (error) {
        res.send({ error: 'db error' });
    });
});


app.post('/users/:userId/scores', function (req, res) {
    req.assert('userId').notEmpty();
    req.checkBody('score').notEmpty();
    var errors = req.validationErrors();
    if (errors) {
        res.send({ error: -1, data: errors });
        return;
    }

    var userId = req.params.userId;
    var score = req.body.score;

    redisClient.zadd('leaderboard', score, userId, function (err, reply) {
        if (!err) {
            User.find({ where: { userId: userId } }).success(function (user) {
                if (score > user.topScore) {
                    user.topScore = score;
                    user.save().success(function () {
                        res.send({ error: '' });
                    }).error(function (error) {
                        res.send({ error: 'db error' });
                    });
                }
                else
                    res.send({ error: '' });

                writeLog('game', {
                    category: 'score',
                    userId: userId,
                    score: score
                });
            });
        }
        else
            res.send({ error: 'cache error' });
    });
});

app.get('/users/:userId/rank', function (req, res) {
    req.assert('userId').notEmpty();
    var errors = req.validateionErrors();
    if (errors) {
        res.send({ error: -1, data: errors });
        return;
    }

    var userId = req.params.userId;

    redisClient.zrank('leaderboard', userId, function (err, reply) {
        if (!err)
            res.send({ error: '', data: { rank: reply } });
        else
            res.send({ error: 'cache error' });
    });
});


app.get('/leaderboard', function (req, res) {
    redisClient.zrevrange('leaderboard', 0, -1, 'withscores', function (err, reply) {
        if (!err) {
            var data = [];
            for (var i = 0, rank = 1; i < reply.length; i += 2, rank++) {
                data.push({ rank: rank, userId: reply[i], score: reply[i + 1] });
            }
            res.send({ error: '', data: data });
        }
        else {
            res.send({ error: 'cache eror' });
        }
    });
});

//아이템 구매
app.post('/users/:userId/items', function (req, res) {
    req.assert('userId').notEmpty();
    req.checkBody('itemId').notEmpty();
    req.checkBody('itemSlot').notEmpty();
    var errors = req.validationErrors();
    if (erors) {
        res.send({ error: -1, data: errors });
        return;
    }

    var userId = req.params.userId;
    var itemId = req.body.itemId;
    var itemSlot = req.body.itemSlot;

    User.find({ where: { userId: userId } }).success(function (user) {
        if (user.coin > itemTable[itemId].coin) {
            user['itemSlot' + itemSlot] = itemId;
            user.coin -= itemTable[itemId].price.coin;
            user.save().success(function () {
                var data = {};
                data['itemSlot' + itemSlot] = itemId;
                res.send({ error: '', data: data });
                WriteLog('shop', {
                    category: 'item',
                    userId: userId,
                    itemSlot: itemSlot,
                    itemId: itemId
                });
            }).error(function (error) {
                res.send({ error: 'db error' });
            });
        }
        else
            res.send({ error: 'not enough coin' });
    }).error(function (error) {
        res.send({ error: 'db error' });
    });
});

server.listen(80);
