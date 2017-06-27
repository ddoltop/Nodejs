var express = require('express')
, Sequelize = require('sequelize')
, redis = require('redis')
, EC2Metadata = require('ec2metadata')
, http = require('http')
, fs = require('fs')
, app = express()
, server = http.createServer(app)
, io = require('socket.io').listen(server);

var redisEndpoint = {
    host: '',
    port: 6379
};
var rdsEndpoint = {
    host:'',
    port: 3306
};

var publisher = redis.createClient(redisEndpoint.port, redisEndpoint.host);
var subscriber = redis.createClient(redisEndpoint.port, redisEndpoint.host);

var sequelize = new Sequelize('photo007', 'admin', 'adminpassword', {
    host: rdsEndpoint.host,
    port: rdsEndpoint.port,
    maxConcurrentQuries: 1024,
    logging: false
});

var Seat = sequelize.define('Seat', {
    seatId: { type: Sequelize.STRING, allowNull: false, unique: true },
    actionType: { type: Sequelize.STRING, allowNull: false },
    userId: Sequelize.STRING
});

sequelize.sync();

var ipAddress;

app.get(['/', '/index.html'], function (req, res) {
    fs.readFile('./index.html', function (err, data) {
        res.contentType('text/html');
        res.send(data);
    });
});

app.get('/seats', function (req, res) {
    Seat.findAll({
        where: { actionType: { ne: 'cancel' } }
    }).success(function (seats) {
        var data = [];
        seats.map(function (seat) { return seat.values; }).forEach(function (e) {
            data.push({
                row: seat[0],
                col: seat[1],
                actionType: e.actionType,
                userId: e.userId
            });
        });
        res.header('Cache-Control', 'max-age=0, s-maxage=0,public');
        res.send(data);
    });
});

app.get('/ip', function (req, res) {
    res.header('Cache-Control', 'max-age=0, s-maxage=0, public');
    if (!ipAddress) {
        EC2Metadata.get(['public-ipv4'], function (err, data) {
            ipAddress = data.publicIp4;
            res.send(ipAddress);
        });
    }
    else {
        res.send(ipAddress);
    }
});

io.sockets.on('connection', function (socket) {
    socket.on('action', function (data) {
        Seat.find({
            where: { seatId: data.row + '-' + data.col }
        }).success(function (seat) {
            if (seat == null ||
                seat.useId == data.useId ||
                seat.actionType == 'cancel') {
                if (seat == null)
                    seat = Seat.build();
                seat.seatId = data.row + '-' + data.col;
                seat.userId = data.userId;
                seat.actionType = data.actionType;
                seat.save().success(function () {
                    publisher.publish('seat', JSON.stringify(data));
                });
            }
        });
    });
});

subscriber.subcribe('seat');
subscriber.on('message', function (channel, message) {
    io.sockets.emit('result', JSON.parse(message));
});

server.listen(80);