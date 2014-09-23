/**
 *
 *  ioBroker.nodejs Controller start/stop and install script
 *
 *  7'2014 hobbyquaker <hq@ccu.io>
 *         bluefox <bluefox@ccu.io>
 *
 *
 */

// TODO:
// - update only lists the versions of adapters and controllers
// - collect versions of all adapters and controllers for specific host
// - select hots on controller page and manage adapters for this host
// - install adapter automatically if adapter must be started on some host
// - list of repositories and active repository in CouchDB (belong to controller)

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var yargs = require('yargs')
    .usage('Commands:\n' +
        '$0 setup [--couch <host>] [--redis <host>]\n' +
        '$0 start\n' +
        '$0 stop\n' +
        '$0 add <adapter> [--enabled] [--host <host>]\n' +
        '$0 del <adapter>\n' +
        '$0 del <adapter>.<instance>\n' +
        '$0 update <repository url>\n' +
        '$0 upgrade <repository url>\n' +
        '$0 upgrade self <repository url>\n' +
        '$0 upgrade <adapter> <repository url>\n' +
        '$0 object get <id>\n' +
        '$0 state get <id>\n' +
        '$0 state getplain <id>\n' +
        '$0 state set <id> <value>\n' +
        '$0 state setplain <id> <value>')
    .default('couch',   '127.0.0.1')
    .default('redis',   '127.0.0.1')
    .default('lang',    'en')
    ;

var ObjectsCouch;
var objects;
var fs;
var ncp;
var password;
var tools;
var request;
var extend;
var mime;
var os;
var states;

switch (yargs.argv._[0]) {

    case "start":
    case "stop":
        var daemon = require("daemonize2").setup({
            main: "controller.js",
            name: "ioBroker controller",
            pidfile: "iobroker.pid",
            stopTimeout: 12000
        });
        daemon[yargs.argv._[0]]();
        break;

    case "update":
        fs =            require('fs');
        tools =         require(__dirname + '/lib/tools.js');
        ObjectsCouch =  require(__dirname + '/lib/couch.js');
        request =       require('request');
        extend =        require('node.extend');
        var repoUrl =   yargs.argv._[1];
        dbConnect(function () {
            showRepo(repoUrl);
        });
        break;

    case "setup":
        fs =            require('fs');
        password =      require(__dirname + '/lib/password.js');
        ObjectsCouch =  require(__dirname + '/lib/couch.js');

        var config;
        if (!fs.existsSync(__dirname + '/conf/iobroker.json')) {
            config = require(__dirname + '/conf/iobroker-dist.json');
            console.log('creating conf/iobroker.json');
            config.couch.host = yargs.argv.couch || '127.0.0.1';
            config.redis.host = yargs.argv.redis || '127.0.0.1';
            fs.writeFileSync(__dirname + '/conf/iobroker.json', JSON.stringify(config));
        }

        var iopkg = JSON.parse(fs.readFileSync(__dirname + '/io-package.json'));

        dbConnect(function () {
            dbSetup();

        });

        break;

    case "add":
    case "install":
        fs =            require('fs');
        os =            require('os');

        tools =         require(__dirname + '/lib/tools.js');
        ObjectsCouch =  require(__dirname + '/lib/couch.js');

        mime =          require('mime');
        extend =        require('node.extend');
        ncp =           require('ncp').ncp;

        ncp.limit =     16;

        var name =      yargs.argv._[1];
        var repoUrl =   yargs.argv._[2];
        var hostname =  os.hostname();

        if (!fs.existsSync(__dirname + '/adapter/' + name)) {
            downloadPacket(repoUrl, name, function () {
                dbConnect(function () {
                    createInstance(name, yargs.argv.enabled, yargs.argv.host || hostname);
                });
            });
        } else {
            dbConnect(function () {
                createInstance(name, yargs.argv.enabled, yargs.argv.host || hostname);
            });
        }
        break;

    case "upload":
        fs =           require('fs');
        mime =         require('mime');
        tools =        require(__dirname + '/lib/tools.js');
        ObjectsCouch = require(__dirname + '/lib/couch.js');
        var name =     yargs.argv._[1];
        if (name) {
            dbConnect(function () {
                uploadAdapter(name, true, function () {
                    uploadAdapter(name, false, function () {

                    });
                });
            });
        } else {
            console.log("No adapter name found!");
            yargs.showHelp();
            process.exit(1);
        }
        break;

    case "delete":
    case "del":
        var adpr     = yargs.argv._[1];
        var instance = yargs.argv._[2];
        if (!adpr) {
            yargs.showHelp();
            process.exit(1);
        }

        if (adpr && adpr.indexOf('.') != -1) {
            var parts = adpr.split('.');
            adpr      = parts[0];
            instance  = parts[1];
        }
        var config =      require(__dirname + '/conf/iobroker.json');
        ObjectsCouch =    require(__dirname + '/lib/couch.js');
        var StatesRedis = require(__dirname + '/lib/redis.js');
        states = new StatesRedis({
            redis: {
                host:    config.redis.host,
                port:    config.redis.port,
                options: config.redis.options
            }
        });


        if (instance !== null && instance !== undefined && instance !== "") {
            dbConnect(function () {
                deleteInstance(adpr, instance);
            });
        } else {
            dbConnect(function () {
                deleteAdapter(adpr);
            });
        }
        break;

    case "object":
        var cmd = yargs.argv._[1];
        var id  = yargs.argv._[2];
        if (id) {
            var config   = require(__dirname + '/conf/iobroker.json');
            ObjectsCouch = require(__dirname + '/lib/couch.js');

            if (cmd == "get") {
                dbConnect(function () {
                    objects.getObject(id, function (err, res) {
                        if (err) {
                            console.log("not found");
                            process.exit(1);
                        } else {
                            console.log(JSON.stringify(res));
                            process.exit();
                        }
                    });
                });
            }
        }
        break;

    case "state":
        var cmd = yargs.argv._[1];
        var id  = yargs.argv._[2];
        if (id) {
            var config =      require(__dirname + '/conf/iobroker.json');
            var StatesRedis = require(__dirname + '/lib/redis.js');
            states = new StatesRedis({
                redis: {
                    host:    config.redis.host,
                    port:    config.redis.port,
                    options: config.redis.options
                }
            });            
            if (cmd == "get") {
                states.getState(id, function (err, obj) {
                    if (err) {
                        console.log("Error: " + err);
                    } else {
                        console.log(JSON.stringify(obj));
                    }
                    process.exit();
                });
            } else if (cmd == "getplain") {
                states.getState(id, function (err, obj) {
                    if (err) {
                        console.log("Error: " + err);
                    } else {
                        if (obj) {
                            console.log(obj.val);
                            console.log(obj.ack);
                            console.log(obj.from);
                            console.log(obj.ts);
                            console.log(obj.lc);
                        } else {
                            console.log(null);
                        }
                    }
                    process.exit();
                });
            } else if (cmd == "set") {
                var val = yargs.argv._[3];
                if (!val) {
                    console.log("Invalid format: No value found.");
                    yargs.showHelp();
                    process.exit();
                } else {
                    try {
                        val = JSON.parse(val);
                    } catch (e) {
                        console.log("Invalid format: Cannot parse json object: " + val);
                    }
                    
                    states.setState(id, val, function () {
                        process.exit();
                    });
                }
            } else if (cmd == "setplain") {
                var val = yargs.argv._[3];
                if (!val) {
                    console.log("Invalid format: No value found.");
                    yargs.showHelp();
                    process.exit();
                } else {
                    states.setState(id, val, function () {
                        process.exit();
                    });
                }
            } else {
                console.log("Invalid format: unknown state command");
                yargs.showHelp();
            }
        } else {
            console.log("Invalid format: no id found");
            yargs.showHelp();
        }
        break;

    case "message":
        var adapter = yargs.argv._[1];
        var instances = [];
        if (adapter) {
            if (adapter.indexOf('.') != -1) {
                instances.push('system.adapter.' + adapter);
            }

            var config =   require(__dirname + '/conf/iobroker.json');
            ObjectsCouch = require(__dirname + '/lib/couch.js');

            dbConnect(function () {
                objects.getObject('system.adapter.' + adapter, function (err, res) {
                    if (err || !res) {
                        console.log("Adapter not found");
                        process.exit(1);
                    } else {
                        if (instances.length === 0) {
                            instances = res.children;
                        }
                        if (!instances.length) {
                            console.log("Error: no one instance installed!");
                            process.exit(1);
                        }

                        var config =      require(__dirname + '/conf/iobroker.json');
                        var StatesRedis = require(__dirname + '/lib/redis.js');
                        states = new StatesRedis({
                            redis: {
                                host:    config.redis.host,
                                port:    config.redis.port,
                                options: config.redis.options
                            }
                        });
                        var cmd = yargs.argv._[2];
                        var msg = yargs.argv._[3];
                        if (!msg) {
                            msg = cmd;
                            cmd = "send";
                        }
                        if (!msg) {
                            console.log("Invalid format: No message found.");
                            yargs.showHelp();
                            process.exit();
                        } else {
                            for(var i = 0; i < instances.length; i++) {
                                states.pushMessage(instances[i] + '.messagebox', {command: cmd, message: msg, from: 'setup'}, function () {
                                    process.exit();
                                });
                            }
                        }
                    }
                });
            });
        } else {
            console.log("Invalid format: no adapter found");
            yargs.showHelp();
        }
        break;

    case "upgrade":
        fs =           require('fs');
        tools =        require(__dirname + '/lib/tools.js');
        ObjectsCouch = require(__dirname + '/lib/couch.js');
        request =      require('request');
        extend =       require('node.extend');
        mime =         require('mime');

        var adapter = yargs.argv._[1];
        var repoUrl = yargs.argv._[2];
        var config  = require(__dirname + '/conf/iobroker.json');

        if (adapter && !repoUrl && adapter.indexOf('/') != -1) {
            adapter = null;
            repoUrl = adapter;
        }

        dbConnect(function () {
            if (adapter) {
                if (adapter == 'self'){
                    upgradeController(repoUrl, true);
                } else {
                    upgradeAdapter(repoUrl, adapter, true);
                }
            } else {
                console.log('loading system.adapter.*');
                objects.getObjectView('system', 'adapter', {}, function (err, res) {
                    var result = [];
                    for (var i = 0; i < res.total_rows; i++) {
                        result.push(res.rows[i].key);
                    }
                    var i = -1;
                    if (result.length) {
                        upgradeAdapterHelper(repoUrl, result, 0, false, function () {
                           console.log('All adapters are processed!');
                           upgradeController(repoUrl, false);
                        });
                    } else {
                        console.log('No one installed adapter found!');
                        upgradeController(repoUrl, false);
                    }
                });
            }
        });


        break;

    default:
        yargs.showHelp();

}

function upgradeAdapterHelper(repoUrl, list, i, forceDowngrade, callback) {
    upgradeAdapter(repoUrl, list[i], forceDowngrade, function () {
        i++;
        if (list[i]) {
            upgradeAdapterHelper(repoUrl, list, i, forceDowngrade, callback);
        } else if (callback) {
            callback();
        }
    });
}

function upgradeAdapter(repoUrl, adapter, forceDowngrade, callback) {
    if (!repoUrl || typeof repoUrl != 'object') {
        getRepositoryFile(repoUrl, function(sources) {
            upgradeAdapter(sources, adapter, forceDowngrade, callback);
        });
        return;
    }

    function finishUpgrade(name, iopack, callback) {
        var count = 0;
        // Upload www and admin files of adapter into CouchDB
        uploadAdapter(name, false, function () {
            objects.extendObject('system.adapter.' + name, {common: {installedVersion: iopack.common.version}}, function () {
                count++;
                if (count == 2) {
                    console.log('Adapter "' + name + '" updated');
                    if (callback) callback(name);
                }
            });
        });
        uploadAdapter(name, true, function () {
            count++;
            if (count == 2) {
                console.log('Adapter "' + name + '" updated');
                if (callback) callback(name);
            }
        });
    }

    // Read actual adapter version
    objects.getObject('system.adapter.' + adapter, function (err, obj) {
        if (err || !obj) {
            console.log('Cannot find adapter "' + adapter + '" or it is not installed');
            if (callback) callback();
        } else {
            var sources = repoUrl;
            // Read actual description of installed adapter with version
            if (!fs.existsSync(__dirname + '/adapter/' + adapter + '/io-package.json')) {
                console.log('Adpater "' + adapter + '" is not installed.');
                if (callback) callback();
                return;
            }
            // Get the url of io-package.json or direct the version
            if (!repoUrl[adapter]) {
                console.log('Adpater "' + adapter + '" is not in the repository and cannot be updated.');
                if (callback) callback();
                return;
            }

            var ioInstalled = require(__dirname + '/adapter/' + adapter + '/io-package.json');

            // If version is included in repository
            if (repoUrl[adapter].version) {
                if (repoUrl[adapter].version == ioInstalled.common.version ||
                    (!forceDowngrade && upToDate(repoUrl[adapter].version, ioInstalled.common.version))) {
                    console.log('Adpater "' + adapter + '" is up to date.');
                    if (callback) callback();
                } else {
                    // Get the adapter from web site
                    downloadPacket(sources, adapter, function(name, ioPack) {
                        finishUpgrade(name, ioPack, callback);
                    });
                }
            } else if (repoUrl[adapter].meta) {
                // Read repository from url or file
                getFile(repoUrl[adapter].meta, 'io-package-' + adapter + '.json', function(fileName) {
                    var iopack;
                    try {
                        iopack = JSON.parse(fs.readFileSync(fileName));
                        fs.unlink(fileName);
                    } catch(e) {
                        console.log('Cannot parse file' + repoUrl[adapter].meta);
                        if (callback) callback();
                        return;
                    }
                    if (iopack.common.version == ioInstalled.common.version ||
                        (!forceDowngrade && upToDate(iopack.common.version, ioInstalled.common.version))) {
                        console.log('Adpater "' + adapter + '" is up to date.');
                        if (callback) callback();
                    } else {
                        // Get the adapter from web site
                        downloadPacket(sources, adapter, function(name, ioPack) {
                            finishUpgrade(name, ioPack, callback);
                        });
                    }
                });
            } else {
                if (forceDowngrade) {
                    console.log('Unable to get version for "' + adapter + '". Update anyway.');
                    // Get the adapter from web site
                    downloadPacket(sources, adapter, function(name, ioPack) {
                        finishUpgrade(name, ioPack, callback);
                    });
                } else {
                    console.log('Unable to get version for "' + adapter + '".');
                }
            }
        }
    });
}

function upgradeController(repoUrl, forceDowngrade, callback) {
    var hostname = require("os").hostname();
    // Read actual adapter version
    objects.getObject('system.host.' + hostname, function (err, obj) {
        if (err || !obj) {
            console.log('Cannot find host "' + hostname + '" or it is not installed');
            if (callback) callback();
        } else {
            var ioPackage = JSON.parse(fs.readFileSync(__dirname + '/io-package.json'));
            if (!ioPackage.common.version) {
                console.log('Hots "' + hostname + '" is not installed.');
                if (callback) callback();
            }
            if (obj.common.version == ioPackage.common.version ||
                (!forceDowngrade && upToDate(obj.common.version, ioPackage.common.version))) {
                console.log('Host "' + hostname + '" is up to date.');
                if (callback) callback();
            } else {
                // Get the adapter from web site
                downloadPacket(repoUrl, obj.common.type, function (name) {
                    console.log('Host "' + hostname + '" updated');
                    if (callback) callback();
                });
            }
        }
    });
}

function dbConnect(callback) {
    objects = new ObjectsCouch({
        logger: {
            debug: function (msg) { },
            info:  function (msg) { },
            warn:  function (msg) {
                console.log(msg);
            },
            error: function (msg) {
                console.log(msg);
            }
        },
        connected: function () {
            if (typeof callback === 'function') callback();
        }
    });
}

// Upload www folder of adapter into couchDB
function uploadAdapter(adapter, isAdmin, callback) {
    var rev;
    var id = adapter + (isAdmin ? '.admin' : '');
    var dir = __dirname + '/adapter/' + adapter + (isAdmin ? '/admin' : '/www');
    var files = [];

    // do not upload www dir of admin adapter
    if (adapter === 'admin' && !isAdmin) {
        if (typeof callback === 'function') callback();
        return;
    }

    function done(err, res) {
        if (err) {
            callback();
        } else {
            console.log('got ' + dir);
            files = res;
            setTimeout(function (_adapter, _isAdmin, _callback) {
                upload(_adapter, _isAdmin, _callback);
            }, 25, adapter, isAdmin, callback);
        }
    }

    objects.getObject(id, function (err, res) {
        if (err || !res) {
            objects.setObject(id, {
                type: 'meta',
                name: id.split('.').pop(),
                parent: 'system.adapter.' + adapter,
                common: {
                    type: isAdmin ? 'admin' : 'www'
                },
                native: {}
            }, function (err, res) {
                rev = res.rev;
                walk(dir, done);

            });
        } else {
            rev = res._rev;
            walk(dir, done);
        }
    });

    function upload(adapter) {
        var file;
        if (!files.length) {
            if (typeof callback === 'function') callback();
        } else {
            file = files.pop();
            var mimeType = mime.lookup(file);
            var attName = file.split('/adapter/');
            attName = attName[1];
            attName = attName.split('/').slice(2).join('/');
            console.log('upload', id, file, attName, mimeType);

            fs.createReadStream(file).pipe(
                objects.insert(id, attName, null, mimeType, {
                    rev: rev
                }, function (err, res) {
                    if (err) {
                        console.log(err);
                        if (typeof callback === 'function') callback();
                    }
                    rev = res.rev;
                    setTimeout(function () {
                        upload();
                    }, 50);
                })
            );
        }

    }

    function walk(dir, done) {
        var results = [];
        fs.readdir(dir, function (err, list) {
            if (err) return done(err);
            var i = 0;
            (function next() {
                var file = list[i++];
                if (!file) return done(null, results);
                file = dir + '/' + file;
                fs.stat(file, function (err, stat) {
                    if (stat && stat.isDirectory()) {
                        walk(file, function (err, res) {
                            results = results.concat(res);
                            next();
                        });
                    } else {
                        results.push(file);
                        next();
                    }
                });
            })();
        });
    }
}

function downloadPacket(repoUrl, packetName, callback) {
    var url;
    var name;

    if (!repoUrl || typeof repoUrl != 'object') {
        getRepositoryFile(repoUrl, function (sources) {
            downloadPacket(sources, packetName, callback);
        });
        return;
    }
    var sources = repoUrl;

    if (sources[packetName]) {
        url = sources[packetName].url;

        // Adapter
        if(!url) {
            console.log('Adapter "' + packetName + '" can be updated only together with ioBroker.nodejs');
            if (typeof callback === 'function') callback(packetName);
            return;
        }
        name = packetName.replace(/[\/ $&*\\]/g, '_');
    } else {
        url = packetName;
        if (url.indexOf("http://") == -1 && url.indexOf("https://") == -1) {
            console.log("Unknown packetName " + packetName);
            process.exit(1);
        }
        name = Math.floor(Math.random() * 0xFFFFFFE);
    }

    if (!request) request = require('request');
    var AdmZip =  require('adm-zip');
    var ncp =     require('ncp').ncp;
    ncp.limit =   16;

    console.log('download ' + url);

    getFile(url, name, function (tmpFile) {
        console.log('unzip ' + tmpFile);

        // Extract files into tmp/
        var zip = new AdmZip(tmpFile);
        zip.extractAllTo(__dirname + '/tmp/' + name, true);
        // Find out the first directory
        var dirs = fs.readdirSync(__dirname + '/tmp/' + name);
        if (dirs.length) {
            var source = __dirname + '/tmp/' + name + ((dirs.length == 1) ? '/' + dirs[0] : '');
            // Copy files into adapter or controller
            if (fs.existsSync(source + '/io-package.json')) {
                var packetIo;
                try {
                    packetIo = JSON.parse(fs.readFileSync(source + '/io-package.json'));
                } catch (e) {
                    console.log('io-package.json has invalid format! Installation terminated.');
                    if (typeof callback === 'function') callback(name, 'Invalid io-package.json!');
                    process.exit(1);
                }

                var destination = __dirname;
                if (!packetIo.common.controller) destination += '/adapter/' + packetIo.common.name;

                console.log('copying ' + source + ' to ' + destination + '(Version: ' + packetIo.common.version + ')');

                ncp(source, destination, function (err) {
                    if (err) {
                        console.log('ncp error: ' + err);
                        process.exit(1);
                    }

                    console.log('delete ' + tmpFile);
                    fs.unlinkSync(tmpFile);
                    console.log('delete ' + __dirname + '/tmp/' + name);
                    tools.rmdirRecursiveSync(__dirname + '/tmp/' + name);

                    if (typeof callback === 'function') callback(name, packetIo);

                });
            } else {
                console.log('io-package.json not found in ' + source + '/io-package.json. Invalid packet! Installation terminated.');
                if (typeof callback === 'function') callback(name, 'Invalid packet!');
                process.exit(1);
            }
        } else {
            console.log('Packet is empty! Installation terminated.');
            if (typeof callback === 'function') callback(name, 'Packet is empty');
            process.exit(1);
        }
    });
}

function installAdapter(adapter, callback) {

    console.log('install adapter ' + adapter);

    if (!fs.existsSync(__dirname + '/adapter/' + adapter + '/io-package.json')) {
        console.log('error: adapter ' + adapter + ' not found');
        process.exit(1);
    }

    try {
        var adapterConf = JSON.parse(fs.readFileSync(__dirname + '/adapter/' + adapter + '/io-package.json'));
    } catch (e) {
        console.log('error: reading io-package.json ' + e);
        process.exit(1);
    }

    function checkDependencies(deps, _enabled, _host) {
        if (!deps || !deps.length) return;

        // Get all installed adapters
        objects.getObjectView("system", "instance", {}, function (err, objs) {
            if (objs.rows.length) {
                for (var i = 0; i < deps.length; i++) {
                    var isFound = false;
                    for (var t = 0; t < objs.rows.length; t++) {
                        if (objs.rows[t] && objs.rows[t].common && objs.rows[t].common.name == deps[i]) {
                            isFound = true;
                            break;
                        }
                    }
                    if (!isFound) {
                        createInstance(deps[i], _enabled, _host);
                    }
                }
            }
        });
    }

    function install() {
        var objs = [];
        if (adapterConf.objects && adapterConf.objects.length > 0) objs = adapterConf.objects;

        if (adapterConf.common.dependencies) {
            checkDependencies(adapterConf.common.dependencies);
        }

        adapterConf.common.installedVersion = adapterConf.common.version;

        objs.push({
            _id:      'system.adapter.' + adapterConf.common.name,
            type:     'adapter',
            common:   adapterConf.common,
            native:   adapterConf.native,
            children: []
        });

        function setObject(callback) {
            if (objs.length === 0) {
                callback();
            } else {
                var obj = objs.pop();
                objects.extendObject(obj._id, obj, function (err, res) {
                    if (err) {
                        console.log('error setObject ' + obj._id + ' ' + err);
                        process.exit(1);
                    } else {
                        console.log('object ' + obj._id + ' created');
                        setTimeout(function (_cb) {
                            setObject(_cb);
                        }, 50, callback);
                    }
                });
            }
        }

        setObject(callback);

        // Copy files to web adapters
        /* TODO @Bluefox - please go another way: the web adapter has to serve the files from couch or directly from the adapter/.../www/ dir

        if (fs.existsSync(__dirname + '/adapter/' + adapter + '/web/') && adapterConf.common.webservers) {
            if (typeof adapterConf.common.webservers == "string") adapterConf.common.webservers = [adapterConf.common.webservers];
            for (var i = 0; i < adapterConf.common.webservers.length; i++) {
                if (fs.existsSync(__dirname + '/adapter/' + adapterConf.common.webservers[i] + '/')) {
                    // Copy files from adapter/<name>/web to adapter/<webName>/
                    copyFiles(__dirname + '/adapter/' + adapter + '/web/', __dirname + '/adapter/' + adapterConf.common.webservers[i] + '/' + adapter + '/');
                }
            }
        }*/

    }

    if (fs.existsSync(__dirname + '/adapter/' + adapter + '/package.json') && !fs.existsSync(__dirname + '/adapter/' + adapter + '/node_modules')) {
        // Install node modules
        var exec = require('child_process').exec;
        var cmd = 'npm install "' + __dirname + '/adapter/' + adapter + '" --production --prefix "' + __dirname + '/adapter/' + adapter + '"';
        console.log(cmd);
        var child = exec(cmd);
        child.stderr.pipe(process.stdout); // TODO this produces unwanted newlines :-(
        // liner.js from http://strongloop.com/strongblog/practical-examples-of-the-new-node-js-streams-api/ could solve this
        child.on('exit', function () {
            uploadAdapter(name, true, function () {
                uploadAdapter(name, false, function () {
                    install();
                });
            });
        });
    } else {
        console.log('no node modules to install')
        uploadAdapter(name, true, function () {
            uploadAdapter(name, false, function () {
                install();
            });
        });
    }
}

function createInstance(adapter, enabled, host, callback) {

    objects.getObject('system.adapter.' + adapter, function (err, doc) {

        // Adapter is not installed - install it now
        if (err || !doc || !doc.common.installedVersion) {
            installAdapter(adapter, function () {
                createInstance(adapter, enabled, host, callback);
            });
            return;
        }

        objects.getObjectView('system', 'instanceStats', {startkey: 'system.adapter.' + adapter + '.', endkey: 'system.adapter.' + adapter + '.\u9999'}, function (err, res) {
            if (err || !res) {
                console.log('error: view instanceStats ' + err);
                process.exit(1);
                return;
            }
            if (enabled === "true")  enabled = true;
            if (enabled === "false") enabled = false;
            var adapterConf;
            var instance = (res.rows && res.rows[0] && res.rows[0].value ? res.rows[0].value.max + 1 : 0);

            if (doc.common.singleton && instance > 0) {
                console.log('error: this adapter does not allow multiple instances');
                process.exit(1);
                return;
            }

            var instanceObj = doc;
            doc = JSON.parse(JSON.stringify(doc));

            instanceObj._id    = 'system.adapter.' + adapter + '.' + instance;
            instanceObj.type   = 'instance';
            instanceObj.parent = 'system.adapter.' + adapter;
            instanceObj.children = [];
            delete instanceObj._rev;
            instanceObj.common.enabled = (enabled === true || enabled === false) ? enabled :
                ((instanceObj.common.enabled === true || instanceObj.common.enabled === false) ? instanceObj.common.enabled : false);
            instanceObj.common.host    = host;

            console.log('create instance ' + adapter);

            var objs = [
                {
                    _id: 'system.adapter.' + adapter + '.' + instance + '.alive',
                    type: 'state',
                    name: adapter + '.' + instance + '.alive',
                    parent: 'system.adapter.' + adapter + '.' + instance,
                    common: {
                        type: 'bool',
                        role: 'indicator.state'
                    },
                    native: {}
                },
                {
                    _id: 'system.adapter.' + adapter + '.' + instance + '.connected',
                    type: 'state',
                    name: adapter + '.' + instance + '.connected',
                    parent: 'system.adapter.' + adapter + '.' + instance,
                    common: {
                        type: 'bool',
                        role: 'indicator.state'
                    },
                    native: {}
                }
            ];

            if (instanceObj.common.messagebox) {
               objs.push({
                    _id: 'system.adapter.' + adapter + '.' + instance + '.messagebox',
                    type: 'state',
                    name: adapter + '.' + instance + '.messagebox',
                    parent: 'system.adapter.' + adapter + '.' + instance,
                    common: {
                        type: 'bool',
                        role: 'adapter.messagebox'
                    },
                    native: {}
                });
            }
            if (instanceObj.common.wakeup) {
                objs.push({
                    _id: 'system.adapter.' + adapter + '.' + instance + '.wakeup',
                    type: 'state',
                    name: adapter + '.' + instance + '.wakeup',
                    parent: 'system.adapter.' + adapter + '.' + instance,
                    common: {
                        type: 'bool',
                        role: 'adapter.wakeup'
                    },
                    native: {}
                });
            }
            if (instanceObj.common.run) {
                objs.push({
                    _id: 'system.adapter.' + adapter + '.' + instance + '.run',
                    type: 'state',
                    name: adapter + '.' + instance + '.run',
                    parent: 'system.adapter.' + adapter + '.' + instance,
                    common: {
                        type: 'bool',
                        role: 'adapter.run'
                    },
                    native: {}
                });
            }

            if (!adapterConf) {
                try {
                    adapterConf = JSON.parse(fs.readFileSync(__dirname + '/adapter/' + adapter + '/io-package.json').toString());
                } catch (e) {
                    console.log('error: reading io-package.json ' + e);
                    process.exit(1);
                }
            }

            if (!adapterConf.instanceObjects) adapterConf.instanceObjects = [];
            if (!adapterConf.objects) adapterConf.objects = [];

            // Create only for this instance the predefined in io-package.json objects
            // It is not necessary to write "system.adapter.name.N." in the object '_id'
            for (var i = 0; i < adapterConf.instanceObjects.length; i++) {
                adapterConf.instanceObjects[i]._id = adapter + '.' + instance + '.' + adapterConf.instanceObjects[i]._id;
                adapterConf.instanceObjects[i].parent = adapter + '.' + instance + '.' + adapterConf.instanceObjects[i].parent;
                objs.push(adapterConf.instanceObjects[i]);
            }

            /* these are already created on adapter install
            if (adapterConf.objects && adapterConf.objects.length > 0) {
                for (var j = 0, l = adapterConf.objects.length; j < l; j++) {
                    objs.push(adapterConf.objects[j]);
                }
            }
            */



            function setObjs() {
                if (objs.length > 0) {
                    var obj = objs.pop();
                    if (obj.parent === instanceObj._id) instanceObj.children.push(obj._id);
                    objects.setObject(obj._id, obj, function (err, res) {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log('object ' + obj._id + ' created');
                        }
                        setTimeout(setObjs, 25);
                    });
                } else {
                    objects.setObject(instanceObj._id, instanceObj, function (err, res) {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log('object ' + instanceObj._id + ' created');
                        }

                        // Update system.adapter.name children
                        doc.children = doc.children || [];
                        if (doc.children.indexOf('system.adapter.' + adapter + '.' + instance) == -1) doc.children.push('system.adapter.' + adapter + '.' + instance);
                        objects.extendObject('system.adapter.' + adapter, {children: doc.children}, function (err, res) {
                            if (err) {
                                console.log(err);
                            } else {
                                console.log('object system.adapter.' + adapter + ' extended');
                            }
                            // done
                            process.exit(0);
                        });
                    });
                }
            }

            setObjs();
        });


    });
}

function getRepositoryFile(urlOrPath, callback) {
    var sources = {};
    // If object was read
    if (urlOrPath && typeof urlOrPath == 'object') {
        if (callback) callback(urlOrPath);
    } else
    if (!urlOrPath) {
        try {
            sources = JSON.parse(fs.readFileSync(__dirname + '/conf/sources.json'));
        } catch (e) {
            console.log('/conf/sources.json does not exits - ignore');
            sources = {};
        }
        try {
            console.log('loading conf/sources-dist.json');
            var sourcesDist = JSON.parse(fs.readFileSync(__dirname + '/conf/sources-dist.json'));
            sources = extend(sourcesDist, sources, true);
        } catch (e) {

        }
        if (callback) callback(sources);
    } else {
        getJson(urlOrPath, callback);
    }
}

// Download file to tmp or return file name directly
function getFile(urlOrPath, fileName, callback) {
    // If object was read
    if (urlOrPath.substring(0, 'http://'.length) == 'http://' ||
        urlOrPath.substring(0, 'https://'.length) == 'https://') {
        var tmpFile = __dirname + '/tmp/' + (fileName || Math.floor(Math.random() * 0xFFFFFFE)) + '.zip';
        request(urlOrPath).pipe(fs.createWriteStream(tmpFile)).on('close', function () {
            console.log('downloaded ' + tmpFile);
            if (callback) callback(tmpFile);
        });
    } else {
        if (fs.existsSync(__dirname + '/' + urlOrPath)) {
            if (callback) callback(__dirname + '/' + urlOrPath);
        } else if (fs.existsSync(__dirname + '/tmp/' + urlOrPath)) {
            if (callback) callback(__dirname + '/tmp/' + urlOrPath);
        } else {
            console.log('File not found: ' + urlOrPath);
            process.exit(1);
        }
    }
}

// Return content of the json file. Download it or read directly
function getJson(urlOrPath, callback) {
    var sources = {};
    // If object was read
    if (urlOrPath && typeof urlOrPath == 'object') {
        if (callback) callback(urlOrPath);
    } else
    if (!urlOrPath) {
        console.log('Empty url!');
        if (callback) callback(null);
   } else {
        if (urlOrPath.substring(0, 'http://'.length) == 'http://' ||
            urlOrPath.substring(0, 'https://'.length) == 'https://') {
            request(urlOrPath, function (error, response, body) {
                if (error || !body || response.statusCode != 200) {
                    console.log('Cannot download json from ' + urlOrPath + '. Error: ' + (error || body));
                    if (callback) callback(null);
                    return;
                }
                try {
                    sources = JSON.parse(body);
                } catch(e) {
                    console.log('Json file is invalid on ' + urlOrPath);
                    if (callback) callback(null);
                    return;
                }

                if (callback) callback(sources);
            });
        } else {
            if (fs.existsSync(__dirname + '/' + urlOrPath)) {
                try {
                    sources = JSON.parse(fs.readFileSync(__dirname + '/' + urlOrPath));
                }catch(e) {
                    console.log('Cannot parse json file from ' + __dirname + '/' + urlOrPath + '. Error: ' + e);
                    if (callback) callback(null);
                    return;
                }
                if (callback) callback(sources);
            } else if (fs.existsSync(__dirname + '/tmp/' + urlOrPath)) {
                try {
                    sources = JSON.parse(fs.readFileSync(__dirname + '/tmp/' + urlOrPath));
                } catch (e) {
                    console.log('Cannot parse json file from ' + __dirname + '/tmp/' + urlOrPath + '. Error: ' + e);
                    if (callback) callback(null);
                    return;
                }
                if (callback) callback(sources);
            } else if (fs.existsSync(__dirname + '/adapter/' + urlOrPath)) {
                try {
                    sources = JSON.parse(fs.readFileSync(__dirname + '/adapter/' + urlOrPath));
                }catch(e) {
                    console.log('Cannot parse json file from ' + __dirname + '/adapter/' + urlOrPath + '. Error: ' + e);
                    if (callback) callback(null);
                    return;
                }
                if (callback) callback(sources);
            } else {
                console.log('Json file not found: ' + urlOrPath);
                if (callback) callback(null);
                return;
            }
        }
    }
}

// Helper methods
function upToDate(a, b) {
    var a = a.split('.');
    var b = b.split('.');
    a[0] = parseInt(a[0], 10);
    b[0] = parseInt(b[0], 10);
    if (a[0] > b[0]) {
        return false;
    } else if (a[0] === b[0]) {
        a[1] = parseInt(a[1], 10);
        b[1] = parseInt(b[1], 10);
        if (a[1] > b[1]) {
            return false;
        } else if (a[1] === b[1]) {
            a[2] = parseInt(a[2], 10);
            b[2] = parseInt(b[2], 10);
            if (a[2] > b[2]) {
                return false;
            } else  {
                return true;
            }
        }
    } else {
        return true;
    }
}

function updateRepo(repoUrl, callback) {
    var result = {};

    if (!repoUrl || typeof repoUrl != 'object') {
        getRepositoryFile(repoUrl, function(sources) {
            updateRepo(sources, callback);
        });
        return;
    }
    var sources = repoUrl;
    var downloads = [];

    function download() {
        if (downloads.length < 1) {
            console.log('update done');
            if (callback) callback(result);
        } else {
            var name = downloads.pop();

            if (sources[name].version) {
                result[name] = sources[name];
            } else if (sources[name].meta) {
                getJson(sources[name].meta, function (ioPack){
                    if (ioPack && ioPack.common) {
                        result[name] = extend(sources[name], ioPack.common, true);
                    }
                    setTimeout(download, 0);
                });
                return;
            } else if (sources[name].url) {
                console.log('Cannot get version of "' + name + '".');
                result[name] = sources[name];
            } else {
                console.log('Cannot get any information of "' + name + '". Ignored.');
            }
            setTimeout(download, 0);
            /*if (elem.url.substring(0, 'https://'.length) == 'https://' ||
             elem.url.substring(0, 'http://'.length)  == 'http://') {
             console.log('http GET ' + elem.url);
             request(elem.url, function (error, response, body) {
             processFile(elem, error, response, body);
             });
             } else {
             try {
             fs.readFile(__dirname + '/adapter/' + elem.url, function (error, body) {
             processFile(elem, error, null, body);
             });
             } catch (e) {
             console.log('Cannot read file "' + __dirname + '/adapter/' + elem.url + '"');
             setTimeout(download, 0);
             }
             }*/
        }

    }

    // Read repository file, local or by url
    for (var name in sources) {
        downloads.push(name);
    }

    download(sources);

    /*console.log('loading system.adapter.*');
    objects.getObjectView('system', 'adapter', {}, function (err, res) {
        var downloads = [];

        for (var i = 0; i < res.total_rows; i++) {
            result[res.rows[i].key] = res.rows[i].value;
        }

        console.log('loading conf/sources.json');

        function processFile(elem, error, response, body) {
            if (!error && (!response || response.statusCode == 200)) {
                if (!response) {
                    console.log('Read ' + __dirname + '/adapter/' + elem.url);
                } else {
                    console.log('http 200 ' + elem.url);
                }
                var _body = {};
                try {
                    _body = JSON.parse(body);
                } catch (e) {
                    console.log('error: json parse failed for ' + elem.url);
                    setTimeout(download, 0);
                    return;
                }
                if (elem.controller) {
                    objects.getObjectView("system", "host", {}, function (err, doc) {
                        if (doc.rows.length) {
                            for (var i = 0; i < doc.rows.length; i++) {
                                if (doc.rows[i].value.type == elem.name) {
                                    var host = doc.rows[i].value;
                                    objects.extendObject(host._id, {common: {version: _body.common.version}});
                                }
                            }
                        }
                    });
                }
                else if (!result[elem.name]) {
                    _body.type = 'adapter';
                    // Add external link to icon
                    if (elem.icon) {
                        _body.common = _body.common || {};
                        _body.common.extIcon = elem.icon;
                    }
                    delete _body.objects;
                    objects.getObject('system.adapter.' + _body.common.name, function (err, res) {
                        if (err || !res) {
                            objects.setObject('system.adapter.' + _body.common.name, _body, function (err, res) {
                                console.log('object ' + res.id + ' created');
                                result[elem.name] = _body;
                                setTimeout(download, 25);
                            });
                        } else {
                            objects.extendObject('system.adapter.' + _body.common.name, _body, function (err, res) {
                                console.log('object ' + res.id + ' extended');
                                result[elem.name] = _body;
                                setTimeout(download, 25);
                            });
                        }
                    });


                } else {
                    if (elem.icon) {
                        _body.common = _body.common || {};
                        _body.common.extIcon = elem.icon;
                    }
                    delete _body.objects;
                    delete result[elem.name]._rev;
                    delete result[elem.name]._id;
                    delete result[elem.name].type;
                    delete result[elem.name].children;
                    if (result[elem.name].common && result[elem.name].common.installedVersion) delete result[elem.name].common.installedVersion;
                    if (result[elem.name]._deleted_conflicts) delete result[elem.name]._deleted_conflicts;
                    if (JSON.stringify(result[elem.name]) != JSON.stringify(_body)) {
                        result[elem.name] = extend(true, result[elem.name], _body);
                        objects.extendObject('system.adapter.' + _body.common.name, _body);
                    }
                    setTimeout(download, 0);
                }

            } else {
                console.log('http ' + (response ? response.statusCode : 'no answer for ') + ' ' + elem.url + ': ' + error);
                setTimeout(download, 0);
            }
        }

    });*/
}

function getInstalledInfo() {
    var result = {};
    var ioPackage = require(__dirname + '/io-package.json');
    result[ioPackage.common.name] = {controller: true, version: ioPackage.common.version};
    var dirs = fs.readdirSync(__dirname + '/adapter');
    for (var i = 0; i < dirs.length; i++) {
        if (fs.existsSync(__dirname + '/adapter/' + dirs[i] + '/io-package.json')) {
            ioPackage = require(__dirname + '/adapter/' + dirs[i] + '/io-package.json');
            result[ioPackage.common.name] = {controller: false, version: ioPackage.common.version};
        }
    }
    return result;
}

function showRepo(repoUrl) {
    updateRepo(repoUrl, function(sources) {
        var installed = getInstalledInfo();

        for (var name in sources) {
            var text = (sources[name].controller ? 'Controller ' : 'Adapter    ');
            text += '"' + name + '"' + ((name.length < 20) ? new Array(20 - name.length).join(' '): '');
            text += ': ' + sources[name].version + ((sources[name].version.length < 10) ? new Array(10 - sources[name].version.length).join(' '): '');

            if (installed[name]) {
                text += ', installed ' + installed[name].version;
                if (sources[name].version != installed[name].version &&
                    upToDate(sources[name].version, installed[name].version)) {
                    text += ' [Updateable]';
                }

            }

            console.log(text);
        }
    });
}

function deleteAdapter(adapter, callback) {
    // Delete instances
    objects.getObjectView("system", "instance", {startkey: adapter, endkey: adapter}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no instances of adapter ' + adapter + ' found');
            } else {
                var count = 0;

                for (var i = 0; i < doc.rows.length; i++) {
                    objects.delObject(doc.rows[i].value._id);
                    count++;
                }
                console.log('deleted ' + count + ' instances of ' + adapter);
            }
        }
    });
    // Delete adapter objects
    objects.getObjectView("system", "adapter", {startkey: adapter, endkey: adapter}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no adapter ' + adapter + ' found');
            } else {
                var tools = require(__dirname + '/lib/tools.js');
                var fs    = require('fs');
                var count = 0;

                for (var i = 0; i < doc.rows.length; i++) {
                    var adapterConf = doc.rows[i].value;

                    // Delete files from web adapters
                    if (fs.existsSync(__dirname + '/adapter/' + adapter + "/web/") && adapterConf.common.webservers) {
                        if (typeof adapterConf.common.webservers == "string") adapterConf.common.webservers = [adapterConf.common.webservers];
                        for (var j = 0; j < adapterConf.common.webservers.length; j++) {
                            if (fs.existsSync(__dirname + '/adapter/' + adapterConf.common.webservers[j] + '/' + adapter + '/')) {
                                // Delete files from adapter/<name>/web to adapter/<webName>/
                                console.log('delete ' + __dirname + '/adapter/' + adapterConf.common.webservers[j] + '/' + adapter + '/');
                                tools.rmdirRecursiveSync(__dirname + '/adapter/' + adapterConf.common.webservers[j] + '/' + adapter + '/');
                            }
                        }
                    }


                    if (adapterConf.common.nondelitable) {
                        console.log('Adapter ' + adapter + ' cannot be deleted completely, because non-deletable.');
                        objects.extendObject(adapterConf._id, {
                            children: [],
                            common: {installedVersion: ''}
                        });

                        continue;
                    }

                    objects.delObject(adapterConf._id);
                    count++;

                    // Delete adapter folder
                    if (!adapterConf.common.noRepository) {
                        console.log('delete ' + __dirname + '/adapter/' + adapter);
                        tools.rmdirRecursiveSync(__dirname + '/adapter/' + adapter);
                    }
                }
                console.log('deleted ' + count + ' adapters for ' + adapter);
            }
        }
    });
    // Delete devices
    objects.getObjectView("system", "device", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no devices ' + adapter + ' found');
            } else {
                var count = 0;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, adapter.length) == adapter) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' devices of ' + adapter);
            }
        }
    });
    // Delete channels
    objects.getObjectView("system", "channel", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no channels ' + adapter + ' found');
            } else {
                var count = 0;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, adapter.length) == adapter) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' channels of ' + adapter);
            }
        }
    });
    // Delete states
    objects.getObjectView("system", "state", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no states ' + adapter + ' found');
            } else {
                var count = 0;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, adapter.length) == adapter) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' states of ' + adapter);
            }
        }
    });
    // Delete WWW pages
    objects.delObject(adapter, function (err, obj, id) {
        if (err) {
            console.log(err);
        } else {
            if (obj) console.log('object ' + adapter + ' deleted');
        }
    });
    // Delete WWW/admin pages
    objects.delObject(adapter + '.admin', function (err, obj, id) {
        if (err) {
            console.log(err);
        } else {
            if (obj) console.log('object ' + adapter + '.admin deleted');
        }
    });

    states.getKeys(adapter + '.*', function (err, obj) {
        if (obj) {
            for (var i = 0; i < obj.length; i++) {
                states.delState(obj[i]);
            }
            console.log ('Deleted ' + obj.length + ' states (' + adapter + '.*) from redis');
        }
    });
    states.getKeys('system.adapter.' + adapter + '.*', function (err, obj) {
        if (obj) {
            for (var i = 0; i < obj.length; i++) {
                states.delState(obj[i]);
            }
            console.log ('Deleted ' + obj.length + ' states (system.adapter.' + adapter + '.*) from redis');
        }

        // Force setup to terminate
        setTimeout(function () {
            process.exit();
        }, 2000);
    });
}

function correctChildren(err, obj) {
    if (!err && obj && obj.children) {
        var pos = obj.children.indexOf(name);
        if (pos != -1) {
            obj.children.splice(pos, 1);
            objects.extendObject(obj._id, {children: obj.children});
        }
    }
}

function deleteInstance(adapter, instance, callback) {
    // Delete instance
    objects.getObjectView("system", "instance", {startkey: adapter, endkey: adapter}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no instances of adapter ' + adapter + ' found');
            } else {
                var count = 0;
                var name = "system.adapter." + adapter + '.' + instance;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (name == doc.rows[i].value._id.substring(0, doc.rows[i].value._id.length)) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                        // Remove id from the adapter children
                        objects.getObject("system.adapter." + adapter, correctChildren);
                    }
                }
                console.log('deleted ' + count + ' instances of ' + adapter + '.' + instance);
            }
        }
    });

    // TODO delete meta objects - i think a recursive deletion of all child object would be less effort.

    // Delete devices
    objects.getObjectView("system", "device", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no devices ' + adapter + ' found');
            } else {
                var count = 0;
                var name = "system.adapter." + adapter + '.' + instance;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, name.length) == name) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' devices of ' + adapter);
            }
        }
    });
    // Delete channels
    objects.getObjectView("system", "channel", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no channels ' + adapter + ' found');
            } else {
                var count = 0;
                var name = "system.adapter." + adapter + '.' + instance;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, name.length) == name) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' channels of ' + adapter);
            }
        }
    });
    // Delete states
    objects.getObjectView("system", "state", {}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no states ' + adapter + ' found');
            } else {
                var count = 0;
                var name = "system.adapter." + adapter + '.' + instance;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i].value._id.substring(0, name.length) == name) {
                        objects.delObject(doc.rows[i].value._id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' states of ' + adapter);
            }
        }
    });

    objects.getObjectList({include_docs: true}, function (err, doc) {
        if (err) {
            console.log(err);
        } else {
            if (doc.rows.length === 0) {
                console.log('no adapter ' + adapter + ' found');
            } else {
                var count = 0;
                var name = adapter + '.' + instance;
                for (var i = 0; i < doc.rows.length; i++) {
                    if (doc.rows[i] &&
                        doc.rows[i].id !== undefined &&
                        doc.rows[i].id.substring(0, name.length) == name) {
                        objects.delObject(doc.rows[i].id);
                        count++;
                    }
                }
                console.log('deleted ' + count + ' states of ' + adapter + '.' + instance);
            }
        }
    });

    // Update children of system.adapter.adaptername
    objects.getObject('system.adapter.' + adapter, function (err, doc) {
        if (!doc.children) return;
        var pos = doc.children.indexOf('system.adapter.' + adapter + '.' + instance);
        if (pos != -1) {
            doc.children.splice(pos, 1);
            objects.extendObject('system.adapter.' + adapter, {children: doc.children}, function (err, res) {
                if (err) {
                    console.log(err);
                } else {
                    console.log('object system.adapter.' + adapter + ' extended');
                }
            });

        } else {
            console.log('Warning: adapter instance not found in the children of system.adapter.' + adapter);
        }
    });

    states.getKeys(adapter + '.' + instance + '*', function (err, obj) {
        for (var i = 0; i < obj.length; i++) {
            states.delState(obj[i]);
        }
        console.log ('Deleted ' + obj.length + ' states from redis');

        // Force setup to terminate
        setTimeout(function () {
            process.exit();
        }, 2000);
    });


}

function setupReady() {
    console.log('database setup done. you can add adapters and start iobroker now');
    process.exit(0);
}

function dbSetup() {
    if (iopkg.objects && iopkg.objects.length > 0) {
        var obj = iopkg.objects.pop();
        objects.setObject(obj._id, obj, function () {
            console.log('object ' + obj._id + ' created');
            setTimeout(dbSetup, 25);
        });
    } else {
        // Default Password for user 'admin' is 'iobroker'
        password('iobroker').hash(null, null, function (err, res) {
            // Create user here and not in io-package.js because of hash password
            var tasks = 0;

            tasks++;
            objects.setObject('system.user.admin', {
                type: 'user',
                common: {
                    name:      'admin',
                    password:   res,
                    dontDelete: true,
                    enabled:    true
                },
                native: {}
            }, function () {
                console.log('object system.user.admin created');
                if (!(--tasks)) setupReady();
            });

            tasks++;
            objects.setObject('system.config', {
                type: 'config',
                common: {
                    language:         '',           // Default language for adapters. Adapters can use different values.
                    tempUnit:         '°C',         // Default temperature units.
                    currency:         '€',          // Default currency sign.
                    dateFormat:       'DD.MM.YYYY', // Default date format.
                    isFloatComma:     true,         // Default float divider ('.' - false, ',' - true)
                    licenseConfirmed: false         // If license agreement confirmed
                }
            }, function () {
                console.log('object system.config created');
                if (!(--tasks)) setupReady();
            });

            // TODO create enum "rooms" if not exist
            /*
            tasks++;
            objects.getObject('enum.rooms', function (err, res) {
             if (!err && res) {
                 if (!(--tasks))setupReady();
             } else {
                 objects.setObject('enum.rooms', {
                     type: 'enum',
                     common: {
                         name: 'uuid',
                         type: 'uuid'
                     },
                     native: {
                         uuid: uuid()
                     }
                 }, function () {
                     console.log('object enum.rooms created');
                     if (!(--tasks)) setupReady();
                 });
             }
            });*/

            tasks++;
            objects.getObject('system.meta.uuid', function (err, res) {
                if (!err && res && res.native && res.native.uuid) {
                    if (!(--tasks)) setupReady();
                } else {
                    objects.setObject('system.meta.uuid', {
                        type: 'meta',
                        common: {
                            name: 'uuid',
                            type: 'uuid'
                        },
                        native: {
                            uuid: uuid()
                        }
                    }, function () {
                        console.log('object system.meta.uuid created');
                        if (!(--tasks)) setupReady();
                    });
                }
            });
        });
    }
}

// Returns a RFC4122 compliant v4 UUID https://gist.github.com/LeverOne/1308368 (DO WTF YOU WANT TO PUBLIC LICENSE)
function uuid(a, b) {
    b = a = '';
    while (a++ < 36) {
        b += a * 51 & 52 ? (a ^ 15 ? 8 ^ Math.random() * (a ^ 20 ? 16 : 4) : 4).toString(16) : '-';
    }
    return b;
}
