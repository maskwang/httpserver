/**
 * app is designed to listen port 80 and handle the http protocal.
 */
var root;
var server;
var domain = require('domain');
var cluster = require('cluster');
var settings = require('../cfg/settings');

exports.runServer = function (rootDirectory) {
    if (cluster.isMaster) {
        //Fork workers.
        var cpus = require('os').cpus().length;
        for (var i = 0; i < cpus; i++) {
            cluster.fork();
        }

        // Restart process after exiting.
        cluster.on('exit', function (worker, code, signal) {
            // Fork a new process after exiting. How about the child process failed to start?
            var exitCode = worker.process.exitCode;
            console.log('worker ' + worker.process.pid + ' died (' + exitCode + ') . restarting...');
            cluster.fork();
        });
    } else {
        // Get root path first.
        root = rootDirectory;

        // Find all global app modules and build the onStart and onRequest array.
        var onStarts = new Array();
        var onRequests = new Array();
        for (var key in settings.modules) {
            var m = require(settings.modules[key]);
            if (m.onStart) {
                onStarts.push(m.onStart);
            }
            if (m.onRequest) {
                onRequests.push(m.onRequest);
            }
        }

        // Perpare onRequest iterator.
        var requestMoving = function (ctx, index) {
            if (index < onRequests.length) {
                if (onRequests[index].length >= 2) {
                    // Async process request if the callback parameter is set. The callback parameter is alwayse the second paramter.
                    onRequests[index](ctx, function (err) {
                        requestMoving(ctx, index + 1);
                    });
                } else {
                    // Sync process the request without callback parameter.
                    onRequests[index](ctx);
                    requestMoving(ctx, index + 1);
                }
            }
        };

        // Workers can share any TCP connection
        // In this case its a HTTP server
        server = require('http').createServer(function (request, response) {
            // Create request domain and handler request domain error.
            var rdomain = domain.create();
            rdomain.on('error', function (err) {
                console.log(err.stack);
                if (request.url.indexOf('debug=nodejs') != -1) {
                    response.end(err.stack);
                } else {
                    response.writeHead(510, 'Internal Server Error');
                    response.end();
                }
                this.dispose();
            });

            // Run http request in domain
            rdomain.run(function () {
                var ctx = {
                    request: request,
                    response: response,
                    rootDirectory: rootDirectory
                };

                requestMoving(ctx, 0);
            });
        });

        /* DEBUG */
        server.on('connection', function (socket) {
            console.log('connection accepted.');
            console.log('worker id:' + cluster.worker.id);
        });

        //Prepare onStart iterator.
        var startMoving = function (index, callback) {
            if (index < onStarts.length) {
                if (onStarts[index].length >= 2) {
                    // Async process request if the callback parameter is set. The callback parameter is alwayse the second parameter.
                    onStarts[index](server, function (err) {
                        if (err) {
                            callback.apply(this, arguments);
                        } else {
                            startMoving(index + 1, callback);
                        }
                    });
                } else {
                    // Sync process the request without callback parameter.
                    var ret = onStarts[index](server);
                    if (ret) {
                        startMoving(index + 1, callback);
                    } else {
                        callback(true, 'Failed To Start Server: ' + index);
                    }
                }
            } else {
                callback();
            }
        };

        // Start all app.
        startMoving(0, function (err) {
            if (err) {
                console.log('Failed To Start Server');
            } else {
                if (settings.port) {
                    server.listen(settings.port, settings.ip);
                }
            }

        });
    }
};

exports.setSettings = function (stgs) {
    settings = stgs;
    return exports;
};

exports.getRootDirectory = function () {
    return root;
};

exports.getHttpServer = function () {
    return server;
};
     
     