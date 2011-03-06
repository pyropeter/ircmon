var util = require('util');
var repl = require('repl');
var net = require('net');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var settings = {
  servers: {
    // === ap
    roddenberry: {host: 'roddenberry.freenode.net'},
    
    // === eu
    kornbluth: {host: 'kornbluth.freenode.net'},
    orwell: {host: 'orwell.freenode.net'}, // not linked
    calvino: {host: 'calvino.freenode.net'},
    gibson: {host: 'gibson.freenode.net'}, // not linked
    leguin: {host: 'leguin.freenode.net'},
    lem: {host: 'lem.freenode.net'}, // not linked
    wolfe: {host: 'wolfe.freenode.net'}, // not linked
    sendak: {host: 'sendak.freenode.net'},
    jordan: {host: 'jordan.freenode.net'},
    lindbohm: {host: 'lindbohm.freenode.net'},
    holmes: {host: 'holmes.freenode.net'},
    barjavel: {host: 'barjavel.freenode.net'},
    bartol: {host: 'bartol.freenode.net'},
    pratchett: {host: 'pratchett.freenode.net'},
    hitchcock: {host: 'hitchcock.freenode.net'},
    
    // === us
    niven: {host: 'niven.freenode.net'},
    zelazny: {host: 'zelazny.freenode.net'},
    brown: {host: 'brown.freenode.net'},
    anthony: {host: 'anthony.freenode.net'},
    kubrick: {host: 'kubrick.freenode.net'}, // not linked
    verne: {host: 'verne.freenode.net'},
    clarke: {host: 'clarke.freenode.net'},
    card: {host: 'card.freenode.net'},
    hubbard: {host: 'hubbard.freenode.net'},
    asimov: {host: 'asimov.freenode.net'},
    stross: {host: 'stross.freenode.net'}
  },
  prefix: "ircmon_",
  realname: "Blame PyroPeter, https://github.com/pyropeter/ircmon",
  wait:        1000 *  8,
  timeout:     1000 *  30,
  downtimeout: 1000 * 600,
  pingtimeout: 1000 * 180,
  conntimeout: 1000 *  20,
  maxlag:      1000 * 240
};

function connect(serverid) {
  var server = settings.servers[serverid];
  server.status = "connecting";
  server.lastres = new Date().getTime();

  if (!server.port) server.port = 6667;
  if (!server.nick) server.nick = settings.prefix + serverid;
  if (!server.cred) server.cred = String(Math.random());
  if (!server.peers) server.peers = {};

  if (server.socket)
    server.socket.destroy()
  server.buffer = "";
  server.error = undefined;
  //server.lag = -1;
  server.lastsend = 0;

  server.socket = new net.Socket();
  server.socket.on('connect', function () {
    server.send("NICK :" + server.nick);
    server.send("USER ircmonitor * * :" + settings.realname);
  });
  server.socket.on('error', function (error) {
    if ((error.syscall == "connect" && (error.code == "ECONNREFUSED" ||
    error.code == "ETIMEDOUT" || error.code == "EHOSTUNREACH"))
    || (/^ENOTFOUND/.test(error.message))) {
      util.log("Server down: " + serverid);
      server.status = "down";
    } else {
      util.log("ERROR: " + serverid);
      console.log(error);
      server.status = "error";
    }
    server.lasterror = error;
    server.lastres = new Date().getTime();
  });
  server.socket.on('end', function () {
    util.log("Remote closed connection: " + serverid);
    server.socket.end();
    server.lastres = new Date().getTime();
    server.status = "closed";
  });
  server.socket.on('data', function (chunk) {
    server.lastres = new Date().getTime();

    server.buffer += chunk;
    var lines = server.buffer.split("\r\n");
    server.buffer = lines.pop();
    for (var i in lines)
      server.socket.emit('line', lines[i]);
  });
  server.socket.on('line', function (line) {
    var match = line.match(/^(?::([^ ]+) )?([^ ]+) (.*)/);
    var prefix = match[1];
    var command = match[2];
    var args = match[3].match(/:.*|[^ ]+/g);
    if (args) args[args.length-1] = args[args.length-1].replace(/^:/,"");

    if (command == "PING") {
      //util.log("received PING");
      server.send("PONG :" + args[0]);
    } else if (command == "001") {
      server.nick = args[0];
      server.status = "connected";
      util.log("Connected: " + serverid);
    } else if (command == "707") {
      util.log("707: " + serverid + ": " + args[2]);
    } else if (0
    || (command == "NOTICE" && args[0] == "*")
    || (command == "MODE")
    || (command == "QUIT")
    || (command == "ERROR")) {
      // drop
    } else if (command == "NICK") {
      if (prefix.match("^[^!]+")[0] == server.nick)
        server.nick = args[0];
    /*} else if (command == "PONG") {
      match = args[1].split(" ");
      // does not check hash, server has to be trusted
      if (match[0] == "ircmon" && parseInt(match[1]) > 0) {
        server.lag = new Date().getTime() - parseInt(match[1]);
      }*/
    } else if (command == "NOTICE") {
      match = args[1].split(" ");
      var peer = settings.servers[match[1]];
      if (match[0] == "\x01ircmon" && peer != undefined &&
      parseInt(match[2]) > 0 && match[3]) {
        var hash = crypto.createHash("sha256");
        hash.update(match[1] + match[2] + peer.cred);
        hash = hash.digest("base64");
        if (match[3] == hash) {
          peer.peers[serverid].last = new Date().getTime();
          peer.peers[serverid].lag = new Date().getTime()-parseInt(match[2]);
          util.log("Pong: " + peer.peers[serverid].lag + "ms     " +
            match[1] + " -> " + serverid);
        } else {
          util.log("Hash check failed: " + match[1] + " " + hash);
        }
      }
    } else if (/^[0123]/.test(command)) {
      server.debug && console.log({
        prefix:prefix,
        command:command,
        args:args
      });
    } else {
      console.log({
        prefix:prefix,
        command:command,
        args:args
      });
    }
  });
  server.send = function (data) {
    //util.log("Send " + serverid + ": " + data);
    server.socket.write(data + "\r\n");
    server.lastsend = new Date().getTime() + Math.floor(
      Math.random() * settings.wait / 5);
  };
  setTimeout(function () {
    if (server.status == "connecting") {
      util.log("Server down: " + serverid);
      server.status = "down";
      server.socket.end();
    }
  }, settings.conntimeout);
  server.socket.connect(server.port, server.host);
}

function servePeers(serverid) {
  var server = settings.servers[serverid];
  var peerid, peer, time, hash, maxdur, maxid, dur;
  time = new Date().getTime();
  if (server.lastsend > time - settings.wait) return;

  maxdur = 0;
  for (peerid in settings.servers) {
    peer = settings.servers[peerid];

    if (peer.status == "connected") {
      if (!server.peers[peerid]) {
        server.peers[peerid] = {
          last: undefined,
          lastsend: peerid == serverid ? 0 : Math.floor(Math.random()*1000),
          lag: Infinity
        };
      }

      dur = time - server.peers[peerid].lastsend;
      if (dur > maxdur) {
        maxdur = dur;
        maxid = peerid;
      }
    }
  }
  if (maxid) {
    peer = settings.servers[maxid];
    hash = crypto.createHash("sha256");
    hash.update(serverid + time + server.cred);
    hash = hash.digest("base64");
    server.send("NOTICE " + peer.nick + " :\x01ircmon " + serverid + " " +
      time + " " + hash);
    server.peers[maxid].lastsend = time;
    //peer.peers[serverid].lastsend = time;
  }
}

setInterval(function () {
  var serverid, server;
  for (serverid in settings.servers) {
    server = settings.servers[serverid];
    if (!server.status) continue;
    
    if (new Date().getTime() - server.lastres > ( server.status == "down" ?
    settings.downtimeout : (server.status == "connected" ?
    settings.pingtimeout : settings.timeout))) {
      util.log("Timeout, reconnecting: " + serverid);
      server.peers = {};
      connect(serverid);
    }
    if (server.status == "connected")
      servePeers(serverid);
  }
}, 100);

setInterval(function () {
  for (var serverid in settings.servers) {
    if (!settings.servers[serverid].status) {
      connect(serverid);
      break;
    }
  }
}, 3000);



function getStats() {
  var time = new Date().getTime();
  var res = {
    time: time,
    servers: {}
  };

  var server, peers, peer;
  for (var serverid in settings.servers) {
    server = settings.servers[serverid];
    peers = {};
    if (server.status == "connected") {
      for (var peerid in server.peers) {
        if (settings.servers[peerid].status != "connected") continue;
        peer = server.peers[peerid];
        if (peer.lastsend) {
          if (peer.lag < time - peer.lastsend) {
            // message was received, no new message was sent
            peers[peerid] = {
              lag: peer.lag,
              last: peer.last
            };
          } else {
            // new message was sent, but not yet received
            if (time - peer.lastsend < settings.maxlag) {
              peers[peerid] = {
                lag: time - peer.lastsend,
                last: time
              };
            }
          }
        }
      }
    }
    res.servers[serverid] = {
      host: server.host,
      status: server.status,
      last: server.lastres,
      peers: peers
    };
  }
  //util.puts(util.inspect(res, false, 10));
  return res;
}

var httpserver = net.createServer(function (client) {
  client.setTimeout(10000);
  client.on('timeout', function () {
    client.destroy();
  });
  client.on('error', function (e) {});
  client.setEncoding("ascii");

  client.once('data', function (chunk) {
    var request = chunk.match(/^GET \/([-a-zA-Z0-9_.]*)(\?[^ ]*)? .*/);
    if (request) {
      if (request[1] == "data.json") {
        var data = new Buffer(JSON.stringify(getStats()));
        try {
          client.write("HTTP/1.1 200 OK\r\n");
          client.write("Content-Type: text/json\r\n");
          client.write("Content-Length: " + data.length + "\r\n");
          client.write("\r\n");
          client.end(data);
        } catch (e) {
          util.log("Error caught in httpserver");
          client.destroy();
        }
      } else {
        var filename = request[1] || "index.html";
        var mimes = {
          html: "text/html",
          js:   "text/javascript",
          json: "text/json",
          css:  "text/css"};
        var mime = mimes[filename.replace(/.*\./,"")] || "text/plain";

        fs.readFile(path.join("www", filename), function (err, data) {
          if (!err) {
            try {
              client.write("HTTP/1.1 200 OK\r\n");
              client.write("Content-Type: " + mime + "\r\n");
              client.write("Content-Length: " + data.length + "\r\n");
              client.write("\r\n");
              client.end(data);
            } catch (e) {
              util.log("Error caught in httpserver");
              client.destroy();
            }
          } else {
            try {
              client.end("HTTP/1.1 404 Not Found\r\n\r\n");
            } catch (e) {
              util.log("Error caught in httpserver");
              client.destroy();
            }
          }
        });
      }
    } else {
      try {
        client.end("HTTP/1.1 500 Bad Request\r\n\r\n");
      } catch (e) {
        util.log("Error caught in httpserver");
        client.destroy();
      }
    }
  });
});
//httpserver.listen(50080, "::1");
httpserver.listen(50005, "localhost");

function shutdown() {
  util.puts("");
  util.log("Quiting...");
  for (var serverid in settings.servers)
    if (settings.servers[serverid].status == "connected")
      settings.servers[serverid].send("QUIT");
  setTimeout(function () {
    util.log("Bye!");
    process.exit();
  }, 2000);
}
process.on('SIGINT', shutdown);

net.createServer(function (socket) {
  var rec = repl.start("freenode@ircmon> ", socket).context;
  rec.util = util;
  rec.net = net;
  rec.settings = settings;
  rec.connect = connect;
  rec.getStats = getStats;
  rec.shutdown = shutdown;
}).listen(50006, "localhost");

util.log("Server started up.");

// vim:set ts=2 sw=2 smartindent et:
