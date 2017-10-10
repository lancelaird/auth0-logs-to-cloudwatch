module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var winston = __webpack_require__(1);
	var async = __webpack_require__(2);
	var moment = __webpack_require__(3);
	var useragent = __webpack_require__(4);
	var express = __webpack_require__(5);
	var Webtask = __webpack_require__(6);
	var app = express();
	var Request = __webpack_require__(7);
	var memoizer = __webpack_require__(8);
	var httpRequest = __webpack_require__(7);
	var metadata = __webpack_require__(9);
	var lawgs = __webpack_require__(10);

	var lawger = null;

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AWS_ACCESS_KEY', 'AWS_SECRET_KEY'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (!lawger) {
	    var aws_access_key = ctx.data.AWS_ACCESS_KEY;
	    var aws_secret_key = ctx.data.AWS_SECRET_KEY;
	    var log_group_name = ctx.data.LOG_GROUP || 'AUTH0_GROUP';
	    var _log_stream_name = ctx.data.LOG_STREAM || 'AUTH0_DOMAIN';

	    lawgs.config({
	      aws: {
	        accessKeyId: aws_access_key,
	        secretAccessKey: aws_secret_key,
	        region: 'us-east-1'
	      }
	    });
	    lawger = lawgs.getOrCreate(log_group_name);
	  }

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startFromId = ctx.data.START_FROM ? ctx.data.START_FROM : null;
	    var startCheckpointId = typeof data === 'undefined' ? startFromId : data.checkpointId;

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);

	        take = take > 100 ? 100 : take;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            return callback({ error: err, message: 'Error getting logs from Auth0' });
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Uploading blobs...');

	      var now = Date.now();

	      async.eachLimit(context.logs, 100, function (log, cb) {
	        var date = moment(log.date);
	        var url = date.format('YYYY/MM/DD') + '/' + date.format('HH') + '/' + log._id + '.json';
	        var body = {};
	        body.post_date = now;
	        body.message = JSON.stringify(log);

	        lawger.log(log_stream_name, body.message);
	        // Actually previous should be checked and in case of err should return
	        // the error; e.g: return cb(error);
	        return cb();

	        // Disabled this section
	        //httpRequest(optionsFactory(body), function (error /*, response, body */) {
	        // if (error) {
	        //    return cb(error);
	        //  }
	        //  return cb();
	        //});
	      }, function (err) {
	        if (err) {
	          return callback({ error: err, message: 'Error sending logs to Logstash' });
	        }

	        console.log('Upload complete.');
	        return callback(null, context);
	      });
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.', err);

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            return res.status(500).send({ error: error, message: 'Error storing startCheckpoint' });
	          }

	          res.status(500).send(err);
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          return res.status(500).send({ error: error, message: 'Error storing checkpoint' });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
	    level: 3 // Error
	  },
	  'f': {
	    event: 'Failed Login',
	    level: 3 // Error
	  },
	  'w': {
	    event: 'Warnings During Login',
	    level: 2 // Warning
	  },
	  'du': {
	    event: 'Deleted User',
	    level: 1 // Info
	  },
	  'fu': {
	    event: 'Failed Login (invalid email/username)',
	    level: 3 // Error
	  },
	  'fp': {
	    event: 'Failed Login (wrong password)',
	    level: 3 // Error
	  },
	  'fc': {
	    event: 'Failed by Connector',
	    level: 3 // Error
	  },
	  'fco': {
	    event: 'Failed by CORS',
	    level: 3 // Error
	  },
	  'con': {
	    event: 'Connector Online',
	    level: 1 // Info
	  },
	  'coff': {
	    event: 'Connector Offline',
	    level: 3 // Error
	  },
	  'fcpro': {
	    event: 'Failed Connector Provisioning',
	    level: 4 // Critical
	  },
	  'ss': {
	    event: 'Success Signup',
	    level: 1 // Info
	  },
	  'fs': {
	    event: 'Failed Signup',
	    level: 3 // Error
	  },
	  'cs': {
	    event: 'Code Sent',
	    level: 0 // Debug
	  },
	  'cls': {
	    event: 'Code/Link Sent',
	    level: 0 // Debug
	  },
	  'sv': {
	    event: 'Success Verification Email',
	    level: 0 // Debug
	  },
	  'fv': {
	    event: 'Failed Verification Email',
	    level: 0 // Debug
	  },
	  'scp': {
	    event: 'Success Change Password',
	    level: 1 // Info
	  },
	  'fcp': {
	    event: 'Failed Change Password',
	    level: 3 // Error
	  },
	  'sce': {
	    event: 'Success Change Email',
	    level: 1 // Info
	  },
	  'fce': {
	    event: 'Failed Change Email',
	    level: 3 // Error
	  },
	  'scu': {
	    event: 'Success Change Username',
	    level: 1 // Info
	  },
	  'fcu': {
	    event: 'Failed Change Username',
	    level: 3 // Error
	  },
	  'scpn': {
	    event: 'Success Change Phone Number',
	    level: 1 // Info
	  },
	  'fcpn': {
	    event: 'Failed Change Phone Number',
	    level: 3 // Error
	  },
	  'svr': {
	    event: 'Success Verification Email Request',
	    level: 0 // Debug
	  },
	  'fvr': {
	    event: 'Failed Verification Email Request',
	    level: 3 // Error
	  },
	  'scpr': {
	    event: 'Success Change Password Request',
	    level: 0 // Debug
	  },
	  'fcpr': {
	    event: 'Failed Change Password Request',
	    level: 3 // Error
	  },
	  'fn': {
	    event: 'Failed Sending Notification',
	    level: 3 // Error
	  },
	  'sapi': {
	    event: 'API Operation'
	  },
	  'fapi': {
	    event: 'Failed API Operation'
	  },
	  'limit_wc': {
	    event: 'Blocked Account',
	    level: 4 // Critical
	  },
	  'limit_ui': {
	    event: 'Too Many Calls to /userinfo',
	    level: 4 // Critical
	  },
	  'api_limit': {
	    event: 'Rate Limit On API',
	    level: 4 // Critical
	  },
	  'sdu': {
	    event: 'Successful User Deletion',
	    level: 1 // Info
	  },
	  'fdu': {
	    event: 'Failed User Deletion',
	    level: 3 // Error
	  }
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err) {
	      console.log('Error getting logs', err);
	      cb(null, err);
	    } else {
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	// This endpoint would be called by webtask-gallery when the extension is installed as custom-extension
	app.get('/meta', function (req, res) {
	  res.status(200).send(metadata);
	});

	module.exports = Webtask.fromExpress(app);

/***/ }),
/* 1 */
/***/ (function(module, exports) {

	module.exports = require("winston");

/***/ }),
/* 2 */
/***/ (function(module, exports) {

	module.exports = require("async");

/***/ }),
/* 3 */
/***/ (function(module, exports) {

	module.exports = require("moment");

/***/ }),
/* 4 */
/***/ (function(module, exports) {

	module.exports = require("useragent");

/***/ }),
/* 5 */
/***/ (function(module, exports) {

	module.exports = require("express");

/***/ }),
/* 6 */
/***/ (function(module, exports) {

	module.exports = require("webtask-tools");

/***/ }),
/* 7 */
/***/ (function(module, exports) {

	module.exports = require("request");

/***/ }),
/* 8 */
/***/ (function(module, exports) {

	module.exports = require("lru-memoizer");

/***/ }),
/* 9 */
/***/ (function(module, exports) {

	module.exports = {
		"title": "Auth0 Logs to Logstash Fix",
		"name": "auth0-logs-to-logstash-fix",
		"version": "2.4.0",
		"author": "saltuk",
		"description": "This extension will take all of your Auth0 logs and export them to Logstash",
		"type": "cron",
		"repository": "https://github.com/saltukalakus/auth0-logs-to-logstash",
		"keywords": [
			"auth0",
			"extension"
		],
		"schedule": "0 */5 * * * *",
		"auth0": {
			"scopes": "read:logs"
		},
		"secrets": {
			"BATCH_SIZE": {
				"description": "The ammount of logs to be read on each execution. Maximun is 100.",
				"default": 100
			},
			"LOG_LEVEL": {
				"description": "This allows you to specify the log level of events that need to be sent",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "0",
						"text": "Debug"
					},
					{
						"value": "1",
						"text": "Info"
					},
					{
						"value": "2",
						"text": "Warning"
					},
					{
						"value": "3",
						"text": "Error"
					},
					{
						"value": "4",
						"text": "Critical"
					}
				]
			},
			"LOG_TYPES": {
				"description": "If you only want to send events with a specific type (eg: failed logins)",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "s",
						"text": "Success Login (Info)"
					},
					{
						"value": "seacft",
						"text": "Success Exchange (Info)"
					},
					{
						"value": "feacft",
						"text": "Failed Exchange (Error)"
					},
					{
						"value": "f",
						"text": "Failed Login (Error)"
					},
					{
						"value": "w",
						"text": "Warnings During Login (Warning)"
					},
					{
						"value": "du",
						"text": "Deleted User (Info)"
					},
					{
						"value": "fu",
						"text": "Failed Login (invalid email/username) (Error)"
					},
					{
						"value": "fp",
						"text": "Failed Login (wrong password) (Error)"
					},
					{
						"value": "fc",
						"text": "Failed by Connector (Error)"
					},
					{
						"value": "fco",
						"text": "Failed by CORS (Error)"
					},
					{
						"value": "con",
						"text": "Connector Online (Info)"
					},
					{
						"value": "coff",
						"text": "Connector Offline (Error)"
					},
					{
						"value": "fcpro",
						"text": "Failed Connector Provisioning (Critical)"
					},
					{
						"value": "ss",
						"text": "Success Signup (Info)"
					},
					{
						"value": "fs",
						"text": "Failed Signup (Error)"
					},
					{
						"value": "cs",
						"text": "Code Sent (Debug)"
					},
					{
						"value": "cls",
						"text": "Code/Link Sent (Debug)"
					},
					{
						"value": "sv",
						"text": "Success Verification Email (Debug)"
					},
					{
						"value": "fv",
						"text": "Failed Verification Email (Debug)"
					},
					{
						"value": "scp",
						"text": "Success Change Password (Info)"
					},
					{
						"value": "fcp",
						"text": "Failed Change Password (Error)"
					},
					{
						"value": "sce",
						"text": "Success Change Email (Info)"
					},
					{
						"value": "fce",
						"text": "Failed Change Email (Error)"
					},
					{
						"value": "scu",
						"text": "Success Change Username (Info)"
					},
					{
						"value": "fcu",
						"text": "Failed Change Username (Error)"
					},
					{
						"value": "scpn",
						"text": "Success Change Phone Number (Info)"
					},
					{
						"value": "fcpn",
						"text": "Failed Change Phone Number (Error)"
					},
					{
						"value": "svr",
						"text": "Success Verification Email Request (Debug)"
					},
					{
						"value": "fvr",
						"text": "Failed Verification Email Request (Error)"
					},
					{
						"value": "scpr",
						"text": "Success Change Password Request (Debug)"
					},
					{
						"value": "fcpr",
						"text": "Failed Change Password Request (Error)"
					},
					{
						"value": "fn",
						"text": "Failed Sending Notification (Error)"
					},
					{
						"value": "limit_wc",
						"text": "Blocked Account (Critical)"
					},
					{
						"value": "limit_ui",
						"text": "Too Many Calls to /userinfo (Critical)"
					},
					{
						"value": "api_limit",
						"text": "Rate Limit On API (Critical)"
					},
					{
						"value": "sdu",
						"text": "Successful User Deletion (Info)"
					},
					{
						"value": "fdu",
						"text": "Failed User Deletion (Error)"
					}
				]
			},
			"START_FROM": {
				"description": "The Auth0 LogId from where you want to start."
			},
			"AWS_ACCESS_KEY": {
				"description": "AWS access key"
			},
			"AWS_SECRET_KEY": {
				"description": "AWS secret key"
			},
			"LOG_GROUP": {
				"description": "Log group"
			},
			"LOG_STREAM": {
				"description": "Log stream"
			}
		}
	};

/***/ }),
/* 10 */
/***/ (function(module, exports, __webpack_require__) {

	var AWS 		= __webpack_require__(11),
	Q 				= __webpack_require__(12),
	Rx 				= __webpack_require__(13),
	extend 			= __webpack_require__(14),
	Enumerable 		= __webpack_require__(15);
	var EventEmitter= __webpack_require__(17).EventEmitter;
	var util 		= __webpack_require__(18);

	var cw;

	var DEFAULT_TIMEOUT = 5000;

	var loggers = {}; // Cache

	var settings = {
		aws: { timeout: DEFAULT_TIMEOUT },
		cloudwatch: { }
	};

	var DATA_ACCEPTED = 'DataAlreadyAcceptedException',
		INVALID_TOKEN = 'InvalidSequenceTokenException';

	function CloudWatchLogger(logGroupName) {
		var me = this;

		// Public properties
		this.showDebugLogs 		= false;
		this.uploadMaxTimer 	= 5000;
		this.uploadBatchSize 	= 500;

		// Private members
		var logGroupName = logGroupName;
		var logGroupExists = false;
		var knownLogStreams = {};
		var nextSequenceTokens = {}; // to ensure sequential upload of logs

		var logsSource = new Rx.Subject();
		var logsStream = logsSource; // Uninitialized yet

		// Read-only properties
		this.__defineGetter__('settings', function() { return settings; });

		// Private functions
		var _log = function() {
			if(me.showDebugLogs) {
				console.log.apply(me, arguments);
			}
		};

		var uploadQueuedLogs = function(logs) {
			_log(logGroupName, '>> uploadQueuedLogs triggered with ', logs.length, ' logs');
			
			var createLogGroup = Q(true);
			if(!logGroupExists) {
				createLogGroup = _createLogGroupIfDoesntExist(logGroupName)
				.then(function() { logGroupExists = true; })
				.catch(function(err) { console.error(err); });
			}

			createLogGroup.then(function() {
				Enumerable.from(logs)
				.groupBy("$.type")
				.forEach(function(group) {
					var logStreamName = group.key(),
					logsToUpload = group.getSource(),
					createLogStream = Q(true);

					if(!(logStreamName in knownLogStreams)) {
						createLogStream = _createLogStreamIfDoesntExist(logGroupName, logStreamName)
						.then(function() { knownLogStreams[logStreamName] = true; })
						.catch(function(err) { console.error(err); });
					}

					createLogStream.then(function() {

						logsToUpload.forEach(function(l) {
							delete l.type;
						});

						_uploadLogs(logGroupName, logStreamName, logsToUpload, nextSequenceTokens[logStreamName])
							.then(function(response) {
								nextSequenceTokens[logStreamName] = response.nextSequenceToken;
								_log('Logs uploaded');
								me.emit('uploaded');
							})
							.catch(function(err){ console.log(err); });
					});

				})
			});

		};

		var subscription = logsStream.subscribe(uploadQueuedLogs);

		var initializeStream = function() {
			if(typeof subscription.dispose === 'function') {
				subscription.dispose(); // dispose
				_log('Disposed subscription');
			}

			logsStream = logsSource
			.windowWithTimeOrCount(me.uploadMaxTimer, me.uploadBatchSize)
			.selectMany(function (x) { return x.toArray(); })
			.where(function(x) { return x.length > 0; });

			subscription = logsStream.subscribe(uploadQueuedLogs);
			_log('Resubscribed');
		};

		// Public API
		this.config = function(conf) {
			extend(this, conf);
			
			if(conf.settings) {
				settings = conf.settings;
			}

			AWS.config.update(settings.aws);
			cw = new AWS.CloudWatchLogs({ apiVersion: '2015-01-28' });
			initializeStream();
		};

		this.log = function(type, obj) {
			obj = { 
				message: typeof obj === 'string' ? obj : JSON.stringify(obj), 
				timestamp: new Date().getTime(), 
				type: type 
			};

			logsSource.onNext(obj);
		};

		/* Log group functions */
		function _createLogGroupIfDoesntExist(name) {
			return _checkLogGroupExists(name)
			.then(function(logGroupExists) {
				if(!logGroupExists) return _createLogGroup(name)
			});
		}

		function _checkLogGroupExists(name) {
			_log('Checking if log group exists:', name);
			var deferred = Q.defer();

			var params = {
				logGroupNamePrefix: name
			};

			cw.describeLogGroups(params, function(err, data) {
				if (err)	deferred.reject(err);
				else		deferred.resolve(data.logGroups.length > 0);
			});

			return deferred.promise.timeout(settings.aws.timeout 
				|| DEFAULT_TIMEOUT, 'Could not communicate with AWS CloudWatch in a timely fashion');
		}

		function _createLogGroup(name) {
			_log('Creating log group:', name);
			var deferred = Q.defer();

			cw.createLogGroup({ logGroupName: name }, function(err, data) {
				if (err)	deferred.reject(err);
				else		deferred.resolve(name);
			});

			return deferred.promise.timeout(settings.aws.timeout 
				|| DEFAULT_TIMEOUT, 'Could not create log group in a timely fashion');
		}

		/* Log streams functions */
		function _createLogStreamIfDoesntExist(group, name) {
			return _checkLogStreamExists(group, name)
			.then(function(logStreamExists) {
				if(!logStreamExists) return _createLogStream(group, name);
			});
		}

		function _checkLogStreamExists(group, name) {
			_log('Checking if log stream exists:', name);
			var deferred = Q.defer();

			var params = {
				logGroupName: group,
				logStreamNamePrefix: name
			};

			cw.describeLogStreams(params, function(err, data) {
				if (err)	deferred.reject(err);
				else		deferred.resolve(data.logStreams.length > 0);
			});

			return deferred.promise.timeout(settings.aws.timeout 
				|| DEFAULT_TIMEOUT, 'Could not communicate with AWS in a timely fashion');
		}

		function _createLogStream(group, name) {
			_log('Creating log stream:', name);
			var deferred = Q.defer();

			cw.createLogStream({ logGroupName: group, logStreamName: name }, function(err, data) {
				if (err)	deferred.reject(err);
				else		deferred.resolve(name);
			});

			return deferred.promise.timeout(settings.aws.timeout 
				|| DEFAULT_TIMEOUT, 'Could not create log stream in a timely fashion');
		}

		// Logging functions
		function _uploadLogs(group, stream, logs, key) {
			_log('Uploading logs');
			var deferred = Q.defer();

			var params = {
				logEvents: logs,
				logGroupName: group,
				logStreamName: stream
			};

			if(key !== undefined && typeof key === 'string') {
				params.sequenceToken = key;
			}

			cw.putLogEvents(params, function(err, data) {
				if (err) {
					if(err.code ===  DATA_ACCEPTED || err.code === INVALID_TOKEN) {
						var nextToken = err.message.split(': ')[1];
						_log('Getting sequence token', nextToken);
						deferred.resolve(_uploadLogs(group, stream, logs, nextToken));
					} else {
						console.error(err);
						deferred.reject(err);
					}
				}
				else deferred.resolve(data);
			});

			return deferred.promise.timeout(settings.aws.timeout 
				|| DEFAULT_TIMEOUT, 'Could not communicate with AWS in a timely fashion');
		}

		this.config({ });
	};

	util.inherits(CloudWatchLogger, EventEmitter);

	module.exports = {

		getOrCreate: function(logGroupName) {
			if(!loggers.hasOwnProperty(logGroupName)) {
				loggers[logGroupName] = new CloudWatchLogger(logGroupName);
			}

			return loggers[logGroupName];
		},

		config: function(s) {
			extend(true, settings, s);
		}

	};


/***/ }),
/* 11 */
/***/ (function(module, exports) {

	module.exports = require("aws-sdk");

/***/ }),
/* 12 */
/***/ (function(module, exports) {

	module.exports = require("q");

/***/ }),
/* 13 */
/***/ (function(module, exports) {

	module.exports = require("rx");

/***/ }),
/* 14 */
/***/ (function(module, exports) {

	module.exports = require("extend");

/***/ }),
/* 15 */
/***/ (function(module, exports, __webpack_require__) {

	var __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;/*--------------------------------------------------------------------------
	 * linq.js - LINQ for JavaScript
	 * ver 3.0.4-Beta5 (Jun. 20th, 2013)
	 *
	 * created and maintained by neuecc <ils@neue.cc>
	 * licensed under MIT License
	 * http://linqjs.codeplex.com/
	 *------------------------------------------------------------------------*/

	(function (root, undefined) {
	    // ReadOnly Function
	    var Functions = {
	        Identity: function (x) { return x; },
	        True: function () { return true; },
	        Blank: function () { }
	    };

	    // const Type
	    var Types = {
	        Boolean: typeof true,
	        Number: typeof 0,
	        String: typeof "",
	        Object: typeof {},
	        Undefined: typeof undefined,
	        Function: typeof function () { }
	    };

	    // createLambda cache
	    var funcCache = { "": Functions.Identity };

	    // private utility methods
	    var Utils = {
	        // Create anonymous function from lambda expression string
	        createLambda: function (expression) {
	            if (expression == null) return Functions.Identity;
	            if (typeof expression === Types.String) {
	                // get from cache
	                var f = funcCache[expression];
	                if (f != null) {
	                    return f;
	                }

	                if (expression.indexOf("=>") === -1) {
	                    var regexp = new RegExp("[$]+", "g");

	                    var maxLength = 0;
	                    var match;
	                    while ((match = regexp.exec(expression)) != null) {
	                        var paramNumber = match[0].length;
	                        if (paramNumber > maxLength) {
	                            maxLength = paramNumber;
	                        }
	                    }

	                    var argArray = [];
	                    for (var i = 1; i <= maxLength; i++) {
	                        var dollar = "";
	                        for (var j = 0; j < i; j++) {
	                            dollar += "$";
	                        }
	                        argArray.push(dollar);
	                    }

	                    var args = Array.prototype.join.call(argArray, ",");

	                    f = new Function(args, "return " + expression);
	                    funcCache[expression] = f;
	                    return f;
	                }
	                else {
	                    var expr = expression.match(/^[(\s]*([^()]*?)[)\s]*=>(.*)/);
	                    f = new Function(expr[1], "return " + expr[2]);
	                    funcCache[expression] = f;
	                    return f;
	                }
	            }
	            return expression;
	        },

	        isIEnumerable: function (obj) {
	            if (typeof Enumerator !== Types.Undefined) {
	                try {
	                    new Enumerator(obj); // check JScript(IE)'s Enumerator
	                    return true;
	                }
	                catch (e) { }
	            }

	            return false;
	        },

	        // IE8's defineProperty is defined but cannot use, therefore check defineProperties
	        defineProperty: (Object.defineProperties != null)
	            ? function (target, methodName, value) {
	                Object.defineProperty(target, methodName, {
	                    enumerable: false,
	                    configurable: true,
	                    writable: true,
	                    value: value
	                })
	            }
	            : function (target, methodName, value) {
	                target[methodName] = value;
	            },

	        compare: function (a, b) {
	            return (a === b) ? 0
	                 : (a > b) ? 1
	                 : -1;
	        },

	        dispose: function (obj) {
	            if (obj != null) obj.dispose();
	        }
	    };

	    // IEnumerator State
	    var State = { Before: 0, Running: 1, After: 2 };

	    // "Enumerator" is conflict JScript's "Enumerator"
	    var IEnumerator = function (initialize, tryGetNext, dispose) {
	        var yielder = new Yielder();
	        var state = State.Before;

	        this.current = yielder.current;

	        this.moveNext = function () {
	            try {
	                switch (state) {
	                    case State.Before:
	                        state = State.Running;
	                        initialize();
	                        // fall through
	                    case State.Running:
	                        if (tryGetNext.apply(yielder)) {
	                            return true;
	                        }
	                        else {
	                            this.dispose();
	                            return false;
	                        }
	                    case State.After:
	                        return false;
	                }
	            }
	            catch (e) {
	                this.dispose();
	                throw e;
	            }
	        };

	        this.dispose = function () {
	            if (state != State.Running) return;

	            try {
	                dispose();
	            }
	            finally {
	                state = State.After;
	            }
	        };
	    };

	    // for tryGetNext
	    var Yielder = function () {
	        var current = null;
	        this.current = function () { return current; };
	        this.yieldReturn = function (value) {
	            current = value;
	            return true;
	        };
	        this.yieldBreak = function () {
	            return false;
	        };
	    };

	    // Enumerable constuctor
	    var Enumerable = function (getEnumerator) {
	        this.getEnumerator = getEnumerator;
	    };

	    // Utility

	    Enumerable.Utils = {}; // container

	    Enumerable.Utils.createLambda = function (expression) {
	        return Utils.createLambda(expression);
	    };

	    Enumerable.Utils.createEnumerable = function (getEnumerator) {
	        return new Enumerable(getEnumerator);
	    };

	    Enumerable.Utils.createEnumerator = function (initialize, tryGetNext, dispose) {
	        return new IEnumerator(initialize, tryGetNext, dispose);
	    };

	    Enumerable.Utils.extendTo = function (type) {
	        var typeProto = type.prototype;
	        var enumerableProto;

	        if (type === Array) {
	            enumerableProto = ArrayEnumerable.prototype;
	            Utils.defineProperty(typeProto, "getSource", function () {
	                return this;
	            });
	        }
	        else {
	            enumerableProto = Enumerable.prototype;
	            Utils.defineProperty(typeProto, "getEnumerator", function () {
	                return Enumerable.from(this).getEnumerator();
	            });
	        }

	        for (var methodName in enumerableProto) {
	            var func = enumerableProto[methodName];

	            // already extended
	            if (typeProto[methodName] == func) continue;

	            // already defined(example Array#reverse/join/forEach...)
	            if (typeProto[methodName] != null) {
	                methodName = methodName + "ByLinq";
	                if (typeProto[methodName] == func) continue; // recheck
	            }

	            if (func instanceof Function) {
	                Utils.defineProperty(typeProto, methodName, func);
	            }
	        }
	    };

	    // Generator

	    Enumerable.choice = function () // variable argument
	    {
	        var args = arguments;

	        return new Enumerable(function () {
	            return new IEnumerator(
	                function () {
	                    args = (args[0] instanceof Array) ? args[0]
	                        : (args[0].getEnumerator != null) ? args[0].toArray()
	                        : args;
	                },
	                function () {
	                    return this.yieldReturn(args[Math.floor(Math.random() * args.length)]);
	                },
	                Functions.Blank);
	        });
	    };

	    Enumerable.cycle = function () // variable argument
	    {
	        var args = arguments;

	        return new Enumerable(function () {
	            var index = 0;
	            return new IEnumerator(
	                function () {
	                    args = (args[0] instanceof Array) ? args[0]
	                        : (args[0].getEnumerator != null) ? args[0].toArray()
	                        : args;
	                },
	                function () {
	                    if (index >= args.length) index = 0;
	                    return this.yieldReturn(args[index++]);
	                },
	                Functions.Blank);
	        });
	    };

	    Enumerable.empty = function () {
	        return new Enumerable(function () {
	            return new IEnumerator(
	                Functions.Blank,
	                function () { return false; },
	                Functions.Blank);
	        });
	    };

	    Enumerable.from = function (obj) {
	        if (obj == null) {
	            return Enumerable.empty();
	        }
	        if (obj instanceof Enumerable) {
	            return obj;
	        }
	        if (typeof obj == Types.Number || typeof obj == Types.Boolean) {
	            return Enumerable.repeat(obj, 1);
	        }
	        if (typeof obj == Types.String) {
	            return new Enumerable(function () {
	                var index = 0;
	                return new IEnumerator(
	                    Functions.Blank,
	                    function () {
	                        return (index < obj.length) ? this.yieldReturn(obj.charAt(index++)) : false;
	                    },
	                    Functions.Blank);
	            });
	        }
	        if (typeof obj != Types.Function) {
	            // array or array like object
	            if (typeof obj.length == Types.Number) {
	                return new ArrayEnumerable(obj);
	            }

	            // JScript's IEnumerable
	            if (!(obj instanceof Object) && Utils.isIEnumerable(obj)) {
	                return new Enumerable(function () {
	                    var isFirst = true;
	                    var enumerator;
	                    return new IEnumerator(
	                        function () { enumerator = new Enumerator(obj); },
	                        function () {
	                            if (isFirst) isFirst = false;
	                            else enumerator.moveNext();

	                            return (enumerator.atEnd()) ? false : this.yieldReturn(enumerator.item());
	                        },
	                        Functions.Blank);
	                });
	            }

	            // WinMD IIterable<T>
	            if (typeof Windows === Types.Object && typeof obj.first === Types.Function) {
	                return new Enumerable(function () {
	                    var isFirst = true;
	                    var enumerator;
	                    return new IEnumerator(
	                        function () { enumerator = obj.first(); },
	                        function () {
	                            if (isFirst) isFirst = false;
	                            else enumerator.moveNext();

	                            return (enumerator.hasCurrent) ? this.yieldReturn(enumerator.current) : this.yieldBreak();
	                        },
	                        Functions.Blank);
	                });
	            }
	        }

	        // case function/object : Create keyValuePair[]
	        return new Enumerable(function () {
	            var array = [];
	            var index = 0;

	            return new IEnumerator(
	                function () {
	                    for (var key in obj) {
	                        var value = obj[key];
	                        if (!(value instanceof Function) && Object.prototype.hasOwnProperty.call(obj, key)) {
	                            array.push({ key: key, value: value });
	                        }
	                    }
	                },
	                function () {
	                    return (index < array.length)
	                        ? this.yieldReturn(array[index++])
	                        : false;
	                },
	                Functions.Blank);
	        });
	    },

	    Enumerable.make = function (element) {
	        return Enumerable.repeat(element, 1);
	    };

	    // Overload:function(input, pattern)
	    // Overload:function(input, pattern, flags)
	    Enumerable.matches = function (input, pattern, flags) {
	        if (flags == null) flags = "";
	        if (pattern instanceof RegExp) {
	            flags += (pattern.ignoreCase) ? "i" : "";
	            flags += (pattern.multiline) ? "m" : "";
	            pattern = pattern.source;
	        }
	        if (flags.indexOf("g") === -1) flags += "g";

	        return new Enumerable(function () {
	            var regex;
	            return new IEnumerator(
	                function () { regex = new RegExp(pattern, flags); },
	                function () {
	                    var match = regex.exec(input);
	                    return (match) ? this.yieldReturn(match) : false;
	                },
	                Functions.Blank);
	        });
	    };

	    // Overload:function(start, count)
	    // Overload:function(start, count, step)
	    Enumerable.range = function (start, count, step) {
	        if (step == null) step = 1;

	        return new Enumerable(function () {
	            var value;
	            var index = 0;

	            return new IEnumerator(
	                function () { value = start - step; },
	                function () {
	                    return (index++ < count)
	                        ? this.yieldReturn(value += step)
	                        : this.yieldBreak();
	                },
	                Functions.Blank);
	        });
	    };

	    // Overload:function(start, count)
	    // Overload:function(start, count, step)
	    Enumerable.rangeDown = function (start, count, step) {
	        if (step == null) step = 1;

	        return new Enumerable(function () {
	            var value;
	            var index = 0;

	            return new IEnumerator(
	                function () { value = start + step; },
	                function () {
	                    return (index++ < count)
	                        ? this.yieldReturn(value -= step)
	                        : this.yieldBreak();
	                },
	                Functions.Blank);
	        });
	    };

	    // Overload:function(start, to)
	    // Overload:function(start, to, step)
	    Enumerable.rangeTo = function (start, to, step) {
	        if (step == null) step = 1;

	        if (start < to) {
	            return new Enumerable(function () {
	                var value;

	                return new IEnumerator(
	                function () { value = start - step; },
	                function () {
	                    var next = value += step;
	                    return (next <= to)
	                        ? this.yieldReturn(next)
	                        : this.yieldBreak();
	                },
	                Functions.Blank);
	            });
	        }
	        else {
	            return new Enumerable(function () {
	                var value;

	                return new IEnumerator(
	                function () { value = start + step; },
	                function () {
	                    var next = value -= step;
	                    return (next >= to)
	                        ? this.yieldReturn(next)
	                        : this.yieldBreak();
	                },
	                Functions.Blank);
	            });
	        }
	    };

	    // Overload:function(element)
	    // Overload:function(element, count)
	    Enumerable.repeat = function (element, count) {
	        if (count != null) return Enumerable.repeat(element).take(count);

	        return new Enumerable(function () {
	            return new IEnumerator(
	                Functions.Blank,
	                function () { return this.yieldReturn(element); },
	                Functions.Blank);
	        });
	    };

	    Enumerable.repeatWithFinalize = function (initializer, finalizer) {
	        initializer = Utils.createLambda(initializer);
	        finalizer = Utils.createLambda(finalizer);

	        return new Enumerable(function () {
	            var element;
	            return new IEnumerator(
	                function () { element = initializer(); },
	                function () { return this.yieldReturn(element); },
	                function () {
	                    if (element != null) {
	                        finalizer(element);
	                        element = null;
	                    }
	                });
	        });
	    };

	    // Overload:function(func)
	    // Overload:function(func, count)
	    Enumerable.generate = function (func, count) {
	        if (count != null) return Enumerable.generate(func).take(count);
	        func = Utils.createLambda(func);

	        return new Enumerable(function () {
	            return new IEnumerator(
	                Functions.Blank,
	                function () { return this.yieldReturn(func()); },
	                Functions.Blank);
	        });
	    };

	    // Overload:function()
	    // Overload:function(start)
	    // Overload:function(start, step)
	    Enumerable.toInfinity = function (start, step) {
	        if (start == null) start = 0;
	        if (step == null) step = 1;

	        return new Enumerable(function () {
	            var value;
	            return new IEnumerator(
	                function () { value = start - step; },
	                function () { return this.yieldReturn(value += step); },
	                Functions.Blank);
	        });
	    };

	    // Overload:function()
	    // Overload:function(start)
	    // Overload:function(start, step)
	    Enumerable.toNegativeInfinity = function (start, step) {
	        if (start == null) start = 0;
	        if (step == null) step = 1;

	        return new Enumerable(function () {
	            var value;
	            return new IEnumerator(
	                function () { value = start + step; },
	                function () { return this.yieldReturn(value -= step); },
	                Functions.Blank);
	        });
	    };

	    Enumerable.unfold = function (seed, func) {
	        func = Utils.createLambda(func);

	        return new Enumerable(function () {
	            var isFirst = true;
	            var value;
	            return new IEnumerator(
	                Functions.Blank,
	                function () {
	                    if (isFirst) {
	                        isFirst = false;
	                        value = seed;
	                        return this.yieldReturn(value);
	                    }
	                    value = func(value);
	                    return this.yieldReturn(value);
	                },
	                Functions.Blank);
	        });
	    };

	    Enumerable.defer = function (enumerableFactory) {

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () { enumerator = Enumerable.from(enumerableFactory()).getEnumerator(); },
	                function () {
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : this.yieldBreak();
	                },
	                function () {
	                    Utils.dispose(enumerator);
	                });
	        });
	    };

	    // Extension Methods

	    /* Projection and Filtering Methods */

	    // Overload:function(func)
	    // Overload:function(func, resultSelector<element>)
	    // Overload:function(func, resultSelector<element, nestLevel>)
	    Enumerable.prototype.traverseBreadthFirst = function (func, resultSelector) {
	        var source = this;
	        func = Utils.createLambda(func);
	        resultSelector = Utils.createLambda(resultSelector);

	        return new Enumerable(function () {
	            var enumerator;
	            var nestLevel = 0;
	            var buffer = [];

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (true) {
	                        if (enumerator.moveNext()) {
	                            buffer.push(enumerator.current());
	                            return this.yieldReturn(resultSelector(enumerator.current(), nestLevel));
	                        }

	                        var next = Enumerable.from(buffer).selectMany(function (x) { return func(x); });
	                        if (!next.any()) {
	                            return false;
	                        }
	                        else {
	                            nestLevel++;
	                            buffer = [];
	                            Utils.dispose(enumerator);
	                            enumerator = next.getEnumerator();
	                        }
	                    }
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(func)
	    // Overload:function(func, resultSelector<element>)
	    // Overload:function(func, resultSelector<element, nestLevel>)
	    Enumerable.prototype.traverseDepthFirst = function (func, resultSelector) {
	        var source = this;
	        func = Utils.createLambda(func);
	        resultSelector = Utils.createLambda(resultSelector);

	        return new Enumerable(function () {
	            var enumeratorStack = [];
	            var enumerator;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (true) {
	                        if (enumerator.moveNext()) {
	                            var value = resultSelector(enumerator.current(), enumeratorStack.length);
	                            enumeratorStack.push(enumerator);
	                            enumerator = Enumerable.from(func(enumerator.current())).getEnumerator();
	                            return this.yieldReturn(value);
	                        }

	                        if (enumeratorStack.length <= 0) return false;
	                        Utils.dispose(enumerator);
	                        enumerator = enumeratorStack.pop();
	                    }
	                },
	                function () {
	                    try {
	                        Utils.dispose(enumerator);
	                    }
	                    finally {
	                        Enumerable.from(enumeratorStack).forEach(function (s) { s.dispose(); });
	                    }
	                });
	        });
	    };

	    Enumerable.prototype.flatten = function () {
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var middleEnumerator = null;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (true) {
	                        if (middleEnumerator != null) {
	                            if (middleEnumerator.moveNext()) {
	                                return this.yieldReturn(middleEnumerator.current());
	                            }
	                            else {
	                                middleEnumerator = null;
	                            }
	                        }

	                        if (enumerator.moveNext()) {
	                            if (enumerator.current() instanceof Array) {
	                                Utils.dispose(middleEnumerator);
	                                middleEnumerator = Enumerable.from(enumerator.current())
	                                    .selectMany(Functions.Identity)
	                                    .flatten()
	                                    .getEnumerator();
	                                continue;
	                            }
	                            else {
	                                return this.yieldReturn(enumerator.current());
	                            }
	                        }

	                        return false;
	                    }
	                },
	                function () {
	                    try {
	                        Utils.dispose(enumerator);
	                    }
	                    finally {
	                        Utils.dispose(middleEnumerator);
	                    }
	                });
	        });
	    };

	    Enumerable.prototype.pairwise = function (selector) {
	        var source = this;
	        selector = Utils.createLambda(selector);

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                    enumerator.moveNext();
	                },
	                function () {
	                    var prev = enumerator.current();
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(selector(prev, enumerator.current()))
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(func)
	    // Overload:function(seed,func<value,element>)
	    Enumerable.prototype.scan = function (seed, func) {
	        var isUseSeed;
	        if (func == null) {
	            func = Utils.createLambda(seed); // arguments[0]
	            isUseSeed = false;
	        } else {
	            func = Utils.createLambda(func);
	            isUseSeed = true;
	        }
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var value;
	            var isFirst = true;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    if (isFirst) {
	                        isFirst = false;
	                        if (!isUseSeed) {
	                            if (enumerator.moveNext()) {
	                                return this.yieldReturn(value = enumerator.current());
	                            }
	                        }
	                        else {
	                            return this.yieldReturn(value = seed);
	                        }
	                    }

	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(value = func(value, enumerator.current()))
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(selector<element>)
	    // Overload:function(selector<element,index>)
	    Enumerable.prototype.select = function (selector) {
	        selector = Utils.createLambda(selector);

	        if (selector.length <= 1) {
	            return new WhereSelectEnumerable(this, null, selector);
	        }
	        else {
	            var source = this;

	            return new Enumerable(function () {
	                var enumerator;
	                var index = 0;

	                return new IEnumerator(
	                    function () { enumerator = source.getEnumerator(); },
	                    function () {
	                        return (enumerator.moveNext())
	                            ? this.yieldReturn(selector(enumerator.current(), index++))
	                            : false;
	                    },
	                    function () { Utils.dispose(enumerator); });
	            });
	        }
	    };

	    // Overload:function(collectionSelector<element>)
	    // Overload:function(collectionSelector<element,index>)
	    // Overload:function(collectionSelector<element>,resultSelector)
	    // Overload:function(collectionSelector<element,index>,resultSelector)
	    Enumerable.prototype.selectMany = function (collectionSelector, resultSelector) {
	        var source = this;
	        collectionSelector = Utils.createLambda(collectionSelector);
	        if (resultSelector == null) resultSelector = function (a, b) { return b; };
	        resultSelector = Utils.createLambda(resultSelector);

	        return new Enumerable(function () {
	            var enumerator;
	            var middleEnumerator = undefined;
	            var index = 0;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    if (middleEnumerator === undefined) {
	                        if (!enumerator.moveNext()) return false;
	                    }
	                    do {
	                        if (middleEnumerator == null) {
	                            var middleSeq = collectionSelector(enumerator.current(), index++);
	                            middleEnumerator = Enumerable.from(middleSeq).getEnumerator();
	                        }
	                        if (middleEnumerator.moveNext()) {
	                            return this.yieldReturn(resultSelector(enumerator.current(), middleEnumerator.current()));
	                        }
	                        Utils.dispose(middleEnumerator);
	                        middleEnumerator = null;
	                    } while (enumerator.moveNext());
	                    return false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(enumerator);
	                    }
	                    finally {
	                        Utils.dispose(middleEnumerator);
	                    }
	                });
	        });
	    };

	    // Overload:function(predicate<element>)
	    // Overload:function(predicate<element,index>)
	    Enumerable.prototype.where = function (predicate) {
	        predicate = Utils.createLambda(predicate);

	        if (predicate.length <= 1) {
	            return new WhereEnumerable(this, predicate);
	        }
	        else {
	            var source = this;

	            return new Enumerable(function () {
	                var enumerator;
	                var index = 0;

	                return new IEnumerator(
	                    function () { enumerator = source.getEnumerator(); },
	                    function () {
	                        while (enumerator.moveNext()) {
	                            if (predicate(enumerator.current(), index++)) {
	                                return this.yieldReturn(enumerator.current());
	                            }
	                        }
	                        return false;
	                    },
	                    function () { Utils.dispose(enumerator); });
	            });
	        }
	    };


	    // Overload:function(selector<element>)
	    // Overload:function(selector<element,index>)
	    Enumerable.prototype.choose = function (selector) {
	        selector = Utils.createLambda(selector);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (enumerator.moveNext()) {
	                        var result = selector(enumerator.current(), index++);
	                        if (result != null) {
	                            return this.yieldReturn(result);
	                        }
	                    }
	                    return this.yieldBreak();
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.ofType = function (type) {
	        var typeName;
	        switch (type) {
	            case Number:
	                typeName = Types.Number;
	                break;
	            case String:
	                typeName = Types.String;
	                break;
	            case Boolean:
	                typeName = Types.Boolean;
	                break;
	            case Function:
	                typeName = Types.Function;
	                break;
	            default:
	                typeName = null;
	                break;
	        }
	        return (typeName === null)
	            ? this.where(function (x) { return x instanceof type; })
	            : this.where(function (x) { return typeof x === typeName; });
	    };

	    // mutiple arguments, last one is selector, others are enumerable
	    Enumerable.prototype.zip = function () {
	        var args = arguments;
	        var selector = Utils.createLambda(arguments[arguments.length - 1]);

	        var source = this;
	        // optimized case:argument is 2
	        if (arguments.length == 2) {
	            var second = arguments[0];

	            return new Enumerable(function () {
	                var firstEnumerator;
	                var secondEnumerator;
	                var index = 0;

	                return new IEnumerator(
	                function () {
	                    firstEnumerator = source.getEnumerator();
	                    secondEnumerator = Enumerable.from(second).getEnumerator();
	                },
	                function () {
	                    if (firstEnumerator.moveNext() && secondEnumerator.moveNext()) {
	                        return this.yieldReturn(selector(firstEnumerator.current(), secondEnumerator.current(), index++));
	                    }
	                    return false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(firstEnumerator);
	                    } finally {
	                        Utils.dispose(secondEnumerator);
	                    }
	                });
	            });
	        }
	        else {
	            return new Enumerable(function () {
	                var enumerators;
	                var index = 0;

	                return new IEnumerator(
	                function () {
	                    var array = Enumerable.make(source)
	                        .concat(Enumerable.from(args).takeExceptLast().select(Enumerable.from))
	                        .select(function (x) { return x.getEnumerator() })
	                        .toArray();
	                    enumerators = Enumerable.from(array);
	                },
	                function () {
	                    if (enumerators.all(function (x) { return x.moveNext() })) {
	                        var array = enumerators
	                            .select(function (x) { return x.current() })
	                            .toArray();
	                        array.push(index++);
	                        return this.yieldReturn(selector.apply(null, array));
	                    }
	                    else {
	                        return this.yieldBreak();
	                    }
	                },
	                function () {
	                    Enumerable.from(enumerators).forEach(Utils.dispose);
	                });
	            });
	        }
	    };

	    // mutiple arguments
	    Enumerable.prototype.merge = function () {
	        var args = arguments;
	        var source = this;

	        return new Enumerable(function () {
	            var enumerators;
	            var index = -1;

	            return new IEnumerator(
	                function () {
	                    enumerators = Enumerable.make(source)
	                        .concat(Enumerable.from(args).select(Enumerable.from))
	                        .select(function (x) { return x.getEnumerator() })
	                        .toArray();
	                },
	                function () {
	                    while (enumerators.length > 0) {
	                        index = (index >= enumerators.length - 1) ? 0 : index + 1;
	                        var enumerator = enumerators[index];

	                        if (enumerator.moveNext()) {
	                            return this.yieldReturn(enumerator.current());
	                        }
	                        else {
	                            enumerator.dispose();
	                            enumerators.splice(index--, 1);
	                        }
	                    }
	                    return this.yieldBreak();
	                },
	                function () {
	                    Enumerable.from(enumerators).forEach(Utils.dispose);
	                });
	        });
	    };

	    /* Join Methods */

	    // Overload:function (inner, outerKeySelector, innerKeySelector, resultSelector)
	    // Overload:function (inner, outerKeySelector, innerKeySelector, resultSelector, compareSelector)
	    Enumerable.prototype.join = function (inner, outerKeySelector, innerKeySelector, resultSelector, compareSelector) {
	        outerKeySelector = Utils.createLambda(outerKeySelector);
	        innerKeySelector = Utils.createLambda(innerKeySelector);
	        resultSelector = Utils.createLambda(resultSelector);
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var outerEnumerator;
	            var lookup;
	            var innerElements = null;
	            var innerCount = 0;

	            return new IEnumerator(
	                function () {
	                    outerEnumerator = source.getEnumerator();
	                    lookup = Enumerable.from(inner).toLookup(innerKeySelector, Functions.Identity, compareSelector);
	                },
	                function () {
	                    while (true) {
	                        if (innerElements != null) {
	                            var innerElement = innerElements[innerCount++];
	                            if (innerElement !== undefined) {
	                                return this.yieldReturn(resultSelector(outerEnumerator.current(), innerElement));
	                            }

	                            innerElement = null;
	                            innerCount = 0;
	                        }

	                        if (outerEnumerator.moveNext()) {
	                            var key = outerKeySelector(outerEnumerator.current());
	                            innerElements = lookup.get(key).toArray();
	                        } else {
	                            return false;
	                        }
	                    }
	                },
	                function () { Utils.dispose(outerEnumerator); });
	        });
	    };

	    // Overload:function (inner, outerKeySelector, innerKeySelector, resultSelector)
	    // Overload:function (inner, outerKeySelector, innerKeySelector, resultSelector, compareSelector)
	    Enumerable.prototype.groupJoin = function (inner, outerKeySelector, innerKeySelector, resultSelector, compareSelector) {
	        outerKeySelector = Utils.createLambda(outerKeySelector);
	        innerKeySelector = Utils.createLambda(innerKeySelector);
	        resultSelector = Utils.createLambda(resultSelector);
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator = source.getEnumerator();
	            var lookup = null;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                    lookup = Enumerable.from(inner).toLookup(innerKeySelector, Functions.Identity, compareSelector);
	                },
	                function () {
	                    if (enumerator.moveNext()) {
	                        var innerElement = lookup.get(outerKeySelector(enumerator.current()));
	                        return this.yieldReturn(resultSelector(enumerator.current(), innerElement));
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    /* Set Methods */

	    Enumerable.prototype.all = function (predicate) {
	        predicate = Utils.createLambda(predicate);

	        var result = true;
	        this.forEach(function (x) {
	            if (!predicate(x)) {
	                result = false;
	                return false; // break
	            }
	        });
	        return result;
	    };

	    // Overload:function()
	    // Overload:function(predicate)
	    Enumerable.prototype.any = function (predicate) {
	        predicate = Utils.createLambda(predicate);

	        var enumerator = this.getEnumerator();
	        try {
	            if (arguments.length == 0) return enumerator.moveNext(); // case:function()

	            while (enumerator.moveNext()) // case:function(predicate)
	            {
	                if (predicate(enumerator.current())) return true;
	            }
	            return false;
	        }
	        finally {
	            Utils.dispose(enumerator);
	        }
	    };

	    Enumerable.prototype.isEmpty = function () {
	        return !this.any();
	    };

	    // multiple arguments
	    Enumerable.prototype.concat = function () {
	        var source = this;

	        if (arguments.length == 1) {
	            var second = arguments[0];

	            return new Enumerable(function () {
	                var firstEnumerator;
	                var secondEnumerator;

	                return new IEnumerator(
	                function () { firstEnumerator = source.getEnumerator(); },
	                function () {
	                    if (secondEnumerator == null) {
	                        if (firstEnumerator.moveNext()) return this.yieldReturn(firstEnumerator.current());
	                        secondEnumerator = Enumerable.from(second).getEnumerator();
	                    }
	                    if (secondEnumerator.moveNext()) return this.yieldReturn(secondEnumerator.current());
	                    return false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(firstEnumerator);
	                    }
	                    finally {
	                        Utils.dispose(secondEnumerator);
	                    }
	                });
	            });
	        }
	        else {
	            var args = arguments;

	            return new Enumerable(function () {
	                var enumerators;

	                return new IEnumerator(
	                    function () {
	                        enumerators = Enumerable.make(source)
	                            .concat(Enumerable.from(args).select(Enumerable.from))
	                            .select(function (x) { return x.getEnumerator() })
	                            .toArray();
	                    },
	                    function () {
	                        while (enumerators.length > 0) {
	                            var enumerator = enumerators[0];

	                            if (enumerator.moveNext()) {
	                                return this.yieldReturn(enumerator.current());
	                            }
	                            else {
	                                enumerator.dispose();
	                                enumerators.splice(0, 1);
	                            }
	                        }
	                        return this.yieldBreak();
	                    },
	                    function () {
	                        Enumerable.from(enumerators).forEach(Utils.dispose);
	                    });
	            });
	        }
	    };

	    Enumerable.prototype.insert = function (index, second) {
	        var source = this;

	        return new Enumerable(function () {
	            var firstEnumerator;
	            var secondEnumerator;
	            var count = 0;
	            var isEnumerated = false;

	            return new IEnumerator(
	                function () {
	                    firstEnumerator = source.getEnumerator();
	                    secondEnumerator = Enumerable.from(second).getEnumerator();
	                },
	                function () {
	                    if (count == index && secondEnumerator.moveNext()) {
	                        isEnumerated = true;
	                        return this.yieldReturn(secondEnumerator.current());
	                    }
	                    if (firstEnumerator.moveNext()) {
	                        count++;
	                        return this.yieldReturn(firstEnumerator.current());
	                    }
	                    if (!isEnumerated && secondEnumerator.moveNext()) {
	                        return this.yieldReturn(secondEnumerator.current());
	                    }
	                    return false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(firstEnumerator);
	                    }
	                    finally {
	                        Utils.dispose(secondEnumerator);
	                    }
	                });
	        });
	    };

	    Enumerable.prototype.alternate = function (alternateValueOrSequence) {
	        var source = this;

	        return new Enumerable(function () {
	            var buffer;
	            var enumerator;
	            var alternateSequence;
	            var alternateEnumerator;

	            return new IEnumerator(
	                function () {
	                    if (alternateValueOrSequence instanceof Array || alternateValueOrSequence.getEnumerator != null) {
	                        alternateSequence = Enumerable.from(Enumerable.from(alternateValueOrSequence).toArray()); // freeze
	                    }
	                    else {
	                        alternateSequence = Enumerable.make(alternateValueOrSequence);
	                    }
	                    enumerator = source.getEnumerator();
	                    if (enumerator.moveNext()) buffer = enumerator.current();
	                },
	                function () {
	                    while (true) {
	                        if (alternateEnumerator != null) {
	                            if (alternateEnumerator.moveNext()) {
	                                return this.yieldReturn(alternateEnumerator.current());
	                            }
	                            else {
	                                alternateEnumerator = null;
	                            }
	                        }

	                        if (buffer == null && enumerator.moveNext()) {
	                            buffer = enumerator.current(); // hasNext
	                            alternateEnumerator = alternateSequence.getEnumerator();
	                            continue; // GOTO
	                        }
	                        else if (buffer != null) {
	                            var retVal = buffer;
	                            buffer = null;
	                            return this.yieldReturn(retVal);
	                        }

	                        return this.yieldBreak();
	                    }
	                },
	                function () {
	                    try {
	                        Utils.dispose(enumerator);
	                    }
	                    finally {
	                        Utils.dispose(alternateEnumerator);
	                    }
	                });
	        });
	    };

	    // Overload:function(value)
	    // Overload:function(value, compareSelector)
	    Enumerable.prototype.contains = function (value, compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);
	        var enumerator = this.getEnumerator();
	        try {
	            while (enumerator.moveNext()) {
	                if (compareSelector(enumerator.current()) === value) return true;
	            }
	            return false;
	        }
	        finally {
	            Utils.dispose(enumerator);
	        }
	    };

	    Enumerable.prototype.defaultIfEmpty = function (defaultValue) {
	        var source = this;
	        if (defaultValue === undefined) defaultValue = null;

	        return new Enumerable(function () {
	            var enumerator;
	            var isFirst = true;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    if (enumerator.moveNext()) {
	                        isFirst = false;
	                        return this.yieldReturn(enumerator.current());
	                    }
	                    else if (isFirst) {
	                        isFirst = false;
	                        return this.yieldReturn(defaultValue);
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function()
	    // Overload:function(compareSelector)
	    Enumerable.prototype.distinct = function (compareSelector) {
	        return this.except(Enumerable.empty(), compareSelector);
	    };

	    Enumerable.prototype.distinctUntilChanged = function (compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var compareKey;
	            var initial;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                },
	                function () {
	                    while (enumerator.moveNext()) {
	                        var key = compareSelector(enumerator.current());

	                        if (initial) {
	                            initial = false;
	                            compareKey = key;
	                            return this.yieldReturn(enumerator.current());
	                        }

	                        if (compareKey === key) {
	                            continue;
	                        }

	                        compareKey = key;
	                        return this.yieldReturn(enumerator.current());
	                    }
	                    return this.yieldBreak();
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(second)
	    // Overload:function(second, compareSelector)
	    Enumerable.prototype.except = function (second, compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var keys;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                    keys = new Dictionary(compareSelector);
	                    Enumerable.from(second).forEach(function (key) { keys.add(key); });
	                },
	                function () {
	                    while (enumerator.moveNext()) {
	                        var current = enumerator.current();
	                        if (!keys.contains(current)) {
	                            keys.add(current);
	                            return this.yieldReturn(current);
	                        }
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(second)
	    // Overload:function(second, compareSelector)
	    Enumerable.prototype.intersect = function (second, compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var keys;
	            var outs;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();

	                    keys = new Dictionary(compareSelector);
	                    Enumerable.from(second).forEach(function (key) { keys.add(key); });
	                    outs = new Dictionary(compareSelector);
	                },
	                function () {
	                    while (enumerator.moveNext()) {
	                        var current = enumerator.current();
	                        if (!outs.contains(current) && keys.contains(current)) {
	                            outs.add(current);
	                            return this.yieldReturn(current);
	                        }
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(second)
	    // Overload:function(second, compareSelector)
	    Enumerable.prototype.sequenceEqual = function (second, compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);

	        var firstEnumerator = this.getEnumerator();
	        try {
	            var secondEnumerator = Enumerable.from(second).getEnumerator();
	            try {
	                while (firstEnumerator.moveNext()) {
	                    if (!secondEnumerator.moveNext()
	                    || compareSelector(firstEnumerator.current()) !== compareSelector(secondEnumerator.current())) {
	                        return false;
	                    }
	                }

	                if (secondEnumerator.moveNext()) return false;
	                return true;
	            }
	            finally {
	                Utils.dispose(secondEnumerator);
	            }
	        }
	        finally {
	            Utils.dispose(firstEnumerator);
	        }
	    };

	    Enumerable.prototype.union = function (second, compareSelector) {
	        compareSelector = Utils.createLambda(compareSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var firstEnumerator;
	            var secondEnumerator;
	            var keys;

	            return new IEnumerator(
	                function () {
	                    firstEnumerator = source.getEnumerator();
	                    keys = new Dictionary(compareSelector);
	                },
	                function () {
	                    var current;
	                    if (secondEnumerator === undefined) {
	                        while (firstEnumerator.moveNext()) {
	                            current = firstEnumerator.current();
	                            if (!keys.contains(current)) {
	                                keys.add(current);
	                                return this.yieldReturn(current);
	                            }
	                        }
	                        secondEnumerator = Enumerable.from(second).getEnumerator();
	                    }
	                    while (secondEnumerator.moveNext()) {
	                        current = secondEnumerator.current();
	                        if (!keys.contains(current)) {
	                            keys.add(current);
	                            return this.yieldReturn(current);
	                        }
	                    }
	                    return false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(firstEnumerator);
	                    }
	                    finally {
	                        Utils.dispose(secondEnumerator);
	                    }
	                });
	        });
	    };

	    /* Ordering Methods */

	    Enumerable.prototype.orderBy = function (keySelector) {
	        return new OrderedEnumerable(this, keySelector, false);
	    };

	    Enumerable.prototype.orderByDescending = function (keySelector) {
	        return new OrderedEnumerable(this, keySelector, true);
	    };

	    Enumerable.prototype.reverse = function () {
	        var source = this;

	        return new Enumerable(function () {
	            var buffer;
	            var index;

	            return new IEnumerator(
	                function () {
	                    buffer = source.toArray();
	                    index = buffer.length;
	                },
	                function () {
	                    return (index > 0)
	                        ? this.yieldReturn(buffer[--index])
	                        : false;
	                },
	                Functions.Blank);
	        });
	    };

	    Enumerable.prototype.shuffle = function () {
	        var source = this;

	        return new Enumerable(function () {
	            var buffer;

	            return new IEnumerator(
	                function () { buffer = source.toArray(); },
	                function () {
	                    if (buffer.length > 0) {
	                        var i = Math.floor(Math.random() * buffer.length);
	                        return this.yieldReturn(buffer.splice(i, 1)[0]);
	                    }
	                    return false;
	                },
	                Functions.Blank);
	        });
	    };

	    Enumerable.prototype.weightedSample = function (weightSelector) {
	        weightSelector = Utils.createLambda(weightSelector);
	        var source = this;

	        return new Enumerable(function () {
	            var sortedByBound;
	            var totalWeight = 0;

	            return new IEnumerator(
	                function () {
	                    sortedByBound = source
	                        .choose(function (x) {
	                            var weight = weightSelector(x);
	                            if (weight <= 0) return null; // ignore 0

	                            totalWeight += weight;
	                            return { value: x, bound: totalWeight };
	                        })
	                        .toArray();
	                },
	                function () {
	                    if (sortedByBound.length > 0) {
	                        var draw = Math.floor(Math.random() * totalWeight) + 1;

	                        var lower = -1;
	                        var upper = sortedByBound.length;
	                        while (upper - lower > 1) {
	                            var index = Math.floor((lower + upper) / 2);
	                            if (sortedByBound[index].bound >= draw) {
	                                upper = index;
	                            }
	                            else {
	                                lower = index;
	                            }
	                        }

	                        return this.yieldReturn(sortedByBound[upper].value);
	                    }

	                    return this.yieldBreak();
	                },
	                Functions.Blank);
	        });
	    };

	    /* Grouping Methods */

	    // Overload:function(keySelector)
	    // Overload:function(keySelector,elementSelector)
	    // Overload:function(keySelector,elementSelector,resultSelector)
	    // Overload:function(keySelector,elementSelector,resultSelector,compareSelector)
	    Enumerable.prototype.groupBy = function (keySelector, elementSelector, resultSelector, compareSelector) {
	        var source = this;
	        keySelector = Utils.createLambda(keySelector);
	        elementSelector = Utils.createLambda(elementSelector);
	        if (resultSelector != null) resultSelector = Utils.createLambda(resultSelector);
	        compareSelector = Utils.createLambda(compareSelector);

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.toLookup(keySelector, elementSelector, compareSelector)
	                        .toEnumerable()
	                        .getEnumerator();
	                },
	                function () {
	                    while (enumerator.moveNext()) {
	                        return (resultSelector == null)
	                            ? this.yieldReturn(enumerator.current())
	                            : this.yieldReturn(resultSelector(enumerator.current().key(), enumerator.current()));
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(keySelector)
	    // Overload:function(keySelector,elementSelector)
	    // Overload:function(keySelector,elementSelector,resultSelector)
	    // Overload:function(keySelector,elementSelector,resultSelector,compareSelector)
	    Enumerable.prototype.partitionBy = function (keySelector, elementSelector, resultSelector, compareSelector) {

	        var source = this;
	        keySelector = Utils.createLambda(keySelector);
	        elementSelector = Utils.createLambda(elementSelector);
	        compareSelector = Utils.createLambda(compareSelector);
	        var hasResultSelector;
	        if (resultSelector == null) {
	            hasResultSelector = false;
	            resultSelector = function (key, group) { return new Grouping(key, group); };
	        }
	        else {
	            hasResultSelector = true;
	            resultSelector = Utils.createLambda(resultSelector);
	        }

	        return new Enumerable(function () {
	            var enumerator;
	            var key;
	            var compareKey;
	            var group = [];

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                    if (enumerator.moveNext()) {
	                        key = keySelector(enumerator.current());
	                        compareKey = compareSelector(key);
	                        group.push(elementSelector(enumerator.current()));
	                    }
	                },
	                function () {
	                    var hasNext;
	                    while ((hasNext = enumerator.moveNext()) == true) {
	                        if (compareKey === compareSelector(keySelector(enumerator.current()))) {
	                            group.push(elementSelector(enumerator.current()));
	                        }
	                        else break;
	                    }

	                    if (group.length > 0) {
	                        var result = (hasResultSelector)
	                            ? resultSelector(key, Enumerable.from(group))
	                            : resultSelector(key, group);
	                        if (hasNext) {
	                            key = keySelector(enumerator.current());
	                            compareKey = compareSelector(key);
	                            group = [elementSelector(enumerator.current())];
	                        }
	                        else group = [];

	                        return this.yieldReturn(result);
	                    }

	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.buffer = function (count) {
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    var array = [];
	                    var index = 0;
	                    while (enumerator.moveNext()) {
	                        array.push(enumerator.current());
	                        if (++index >= count) return this.yieldReturn(array);
	                    }
	                    if (array.length > 0) return this.yieldReturn(array);
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    /* Aggregate Methods */

	    // Overload:function(func)
	    // Overload:function(seed,func)
	    // Overload:function(seed,func,resultSelector)
	    Enumerable.prototype.aggregate = function (seed, func, resultSelector) {
	        resultSelector = Utils.createLambda(resultSelector);
	        return resultSelector(this.scan(seed, func, resultSelector).last());
	    };

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.average = function (selector) {
	        selector = Utils.createLambda(selector);

	        var sum = 0;
	        var count = 0;
	        this.forEach(function (x) {
	            sum += selector(x);
	            ++count;
	        });

	        return sum / count;
	    };

	    // Overload:function()
	    // Overload:function(predicate)
	    Enumerable.prototype.count = function (predicate) {
	        predicate = (predicate == null) ? Functions.True : Utils.createLambda(predicate);

	        var count = 0;
	        this.forEach(function (x, i) {
	            if (predicate(x, i))++count;
	        });
	        return count;
	    };

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.max = function (selector) {
	        if (selector == null) selector = Functions.Identity;
	        return this.select(selector).aggregate(function (a, b) { return (a > b) ? a : b; });
	    };

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.min = function (selector) {
	        if (selector == null) selector = Functions.Identity;
	        return this.select(selector).aggregate(function (a, b) { return (a < b) ? a : b; });
	    };

	    Enumerable.prototype.maxBy = function (keySelector) {
	        keySelector = Utils.createLambda(keySelector);
	        return this.aggregate(function (a, b) { return (keySelector(a) > keySelector(b)) ? a : b; });
	    };

	    Enumerable.prototype.minBy = function (keySelector) {
	        keySelector = Utils.createLambda(keySelector);
	        return this.aggregate(function (a, b) { return (keySelector(a) < keySelector(b)) ? a : b; });
	    };

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.sum = function (selector) {
	        if (selector == null) selector = Functions.Identity;
	        return this.select(selector).aggregate(0, function (a, b) { return a + b; });
	    };

	    /* Paging Methods */

	    Enumerable.prototype.elementAt = function (index) {
	        var value;
	        var found = false;
	        this.forEach(function (x, i) {
	            if (i == index) {
	                value = x;
	                found = true;
	                return false;
	            }
	        });

	        if (!found) throw new Error("index is less than 0 or greater than or equal to the number of elements in source.");
	        return value;
	    };

	    Enumerable.prototype.elementAtOrDefault = function (index, defaultValue) {
	        if (defaultValue === undefined) defaultValue = null;
	        var value;
	        var found = false;
	        this.forEach(function (x, i) {
	            if (i == index) {
	                value = x;
	                found = true;
	                return false;
	            }
	        });

	        return (!found) ? defaultValue : value;
	    };

	    // Overload:function()
	    // Overload:function(predicate)
	    Enumerable.prototype.first = function (predicate) {
	        if (predicate != null) return this.where(predicate).first();

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            value = x;
	            found = true;
	            return false;
	        });

	        if (!found) throw new Error("first:No element satisfies the condition.");
	        return value;
	    };

	    Enumerable.prototype.firstOrDefault = function (predicate, defaultValue) {
	        if (predicate) {
	            if (typeof predicate === Types.Function || typeof Utils.createLambda(predicate) === Types.Function)
	                return this.where(predicate).firstOrDefault(null, defaultValue);

	                defaultValue = predicate;
	        }

	        defaultValue = defaultValue || null;

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            value = x;
	            found = true;
	            return false;
	        });
	        return (!found) ? defaultValue : value;
	    };

	    // Overload:function()
	    // Overload:function(predicate)
	    Enumerable.prototype.last = function (predicate) {
	        if (predicate != null) return this.where(predicate).last();

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            found = true;
	            value = x;
	        });

	        if (!found) throw new Error("last:No element satisfies the condition.");
	        return value;
	    };

	    // Overload:function(defaultValue)
	    // Overload:function(defaultValue,predicate)
	    Enumerable.prototype.lastOrDefault = function (predicate, defaultValue) {
	        if (predicate) {
	            if (typeof predicate === Types.Function || typeof Utils.createLambda(predicate) === Types.Function)
	              return this.where(predicate).lastOrDefault(null, defaultValue);

	            defaultValue = predicate;
	        }

	        defaultValue = defaultValue || null;

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            found = true;
	            value = x;
	        });
	        return (!found) ? defaultValue : value;
	    };

	    // Overload:function()
	    // Overload:function(predicate)
	    Enumerable.prototype.single = function (predicate) {
	        if (predicate != null) return this.where(predicate).single();

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            if (!found) {
	                found = true;
	                value = x;
	            } else throw new Error("single:sequence contains more than one element.");
	        });

	        if (!found) throw new Error("single:No element satisfies the condition.");
	        return value;
	    };

	    // Overload:function(defaultValue)
	    // Overload:function(defaultValue,predicate)
	    Enumerable.prototype.singleOrDefault = function (predicate, defaultValue) {
	        if (defaultValue === undefined) defaultValue = null;
	        if (predicate != null) return this.where(predicate).singleOrDefault(null, defaultValue);

	        var value;
	        var found = false;
	        this.forEach(function (x) {
	            if (!found) {
	                found = true;
	                value = x;
	            } else throw new Error("single:sequence contains more than one element.");
	        });

	        return (!found) ? defaultValue : value;
	    };

	    Enumerable.prototype.skip = function (count) {
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;

	            return new IEnumerator(
	                function () {
	                    enumerator = source.getEnumerator();
	                    while (index++ < count && enumerator.moveNext()) {
	                    }
	                    ;
	                },
	                function () {
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(predicate<element>)
	    // Overload:function(predicate<element,index>)
	    Enumerable.prototype.skipWhile = function (predicate) {
	        predicate = Utils.createLambda(predicate);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;
	            var isSkipEnd = false;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (!isSkipEnd) {
	                        if (enumerator.moveNext()) {
	                            if (!predicate(enumerator.current(), index++)) {
	                                isSkipEnd = true;
	                                return this.yieldReturn(enumerator.current());
	                            }
	                            continue;
	                        } else return false;
	                    }

	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;

	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.take = function (count) {
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    return (index++ < count && enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); }
	            );
	        });
	    };

	    // Overload:function(predicate<element>)
	    // Overload:function(predicate<element,index>)
	    Enumerable.prototype.takeWhile = function (predicate) {
	        predicate = Utils.createLambda(predicate);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    return (enumerator.moveNext() && predicate(enumerator.current(), index++))
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function()
	    // Overload:function(count)
	    Enumerable.prototype.takeExceptLast = function (count) {
	        if (count == null) count = 1;
	        var source = this;

	        return new Enumerable(function () {
	            if (count <= 0) return source.getEnumerator(); // do nothing

	            var enumerator;
	            var q = [];

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    while (enumerator.moveNext()) {
	                        if (q.length == count) {
	                            q.push(enumerator.current());
	                            return this.yieldReturn(q.shift());
	                        }
	                        q.push(enumerator.current());
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.takeFromLast = function (count) {
	        if (count <= 0 || count == null) return Enumerable.empty();
	        var source = this;

	        return new Enumerable(function () {
	            var sourceEnumerator;
	            var enumerator;
	            var q = [];

	            return new IEnumerator(
	                function () { sourceEnumerator = source.getEnumerator(); },
	                function () {
	                    while (sourceEnumerator.moveNext()) {
	                        if (q.length == count) q.shift();
	                        q.push(sourceEnumerator.current());
	                    }
	                    if (enumerator == null) {
	                        enumerator = Enumerable.from(q).getEnumerator();
	                    }
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(item)
	    // Overload:function(predicate)
	    Enumerable.prototype.indexOf = function (item) {
	        var found = null;

	        // item as predicate
	        if (typeof (item) === Types.Function) {
	            this.forEach(function (x, i) {
	                if (item(x, i)) {
	                    found = i;
	                    return false;
	                }
	            });
	        }
	        else {
	            this.forEach(function (x, i) {
	                if (x === item) {
	                    found = i;
	                    return false;
	                }
	            });
	        }

	        return (found !== null) ? found : -1;
	    };

	    // Overload:function(item)
	    // Overload:function(predicate)
	    Enumerable.prototype.lastIndexOf = function (item) {
	        var result = -1;

	        // item as predicate
	        if (typeof (item) === Types.Function) {
	            this.forEach(function (x, i) {
	                if (item(x, i)) result = i;
	            });
	        }
	        else {
	            this.forEach(function (x, i) {
	                if (x === item) result = i;
	            });
	        }

	        return result;
	    };

	    /* Convert Methods */

	    Enumerable.prototype.cast = function () {
	        return this;
	    };

	    Enumerable.prototype.asEnumerable = function () {
	        return Enumerable.from(this);
	    };

	    Enumerable.prototype.toArray = function () {
	        var array = [];
	        this.forEach(function (x) { array.push(x); });
	        return array;
	    };

	    // Overload:function(keySelector)
	    // Overload:function(keySelector, elementSelector)
	    // Overload:function(keySelector, elementSelector, compareSelector)
	    Enumerable.prototype.toLookup = function (keySelector, elementSelector, compareSelector) {
	        keySelector = Utils.createLambda(keySelector);
	        elementSelector = Utils.createLambda(elementSelector);
	        compareSelector = Utils.createLambda(compareSelector);

	        var dict = new Dictionary(compareSelector);
	        this.forEach(function (x) {
	            var key = keySelector(x);
	            var element = elementSelector(x);

	            var array = dict.get(key);
	            if (array !== undefined) array.push(element);
	            else dict.add(key, [element]);
	        });
	        return new Lookup(dict);
	    };

	    Enumerable.prototype.toObject = function (keySelector, elementSelector) {
	        keySelector = Utils.createLambda(keySelector);
	        elementSelector = Utils.createLambda(elementSelector);

	        var obj = {};
	        this.forEach(function (x) {
	            obj[keySelector(x)] = elementSelector(x);
	        });
	        return obj;
	    };

	    // Overload:function(keySelector, elementSelector)
	    // Overload:function(keySelector, elementSelector, compareSelector)
	    Enumerable.prototype.toDictionary = function (keySelector, elementSelector, compareSelector) {
	        keySelector = Utils.createLambda(keySelector);
	        elementSelector = Utils.createLambda(elementSelector);
	        compareSelector = Utils.createLambda(compareSelector);

	        var dict = new Dictionary(compareSelector);
	        this.forEach(function (x) {
	            dict.add(keySelector(x), elementSelector(x));
	        });
	        return dict;
	    };

	    // Overload:function()
	    // Overload:function(replacer)
	    // Overload:function(replacer, space)
	    Enumerable.prototype.toJSONString = function (replacer, space) {
	        if (typeof JSON === Types.Undefined || JSON.stringify == null) {
	            throw new Error("toJSONString can't find JSON.stringify. This works native JSON support Browser or include json2.js");
	        }
	        return JSON.stringify(this.toArray(), replacer, space);
	    };

	    // Overload:function()
	    // Overload:function(separator)
	    // Overload:function(separator,selector)
	    Enumerable.prototype.toJoinedString = function (separator, selector) {
	        if (separator == null) separator = "";
	        if (selector == null) selector = Functions.Identity;

	        return this.select(selector).toArray().join(separator);
	    };


	    /* Action Methods */

	    // Overload:function(action<element>)
	    // Overload:function(action<element,index>)
	    Enumerable.prototype.doAction = function (action) {
	        var source = this;
	        action = Utils.createLambda(action);

	        return new Enumerable(function () {
	            var enumerator;
	            var index = 0;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    if (enumerator.moveNext()) {
	                        action(enumerator.current(), index++);
	                        return this.yieldReturn(enumerator.current());
	                    }
	                    return false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    // Overload:function(action<element>)
	    // Overload:function(action<element,index>)
	    // Overload:function(func<element,bool>)
	    // Overload:function(func<element,index,bool>)
	    Enumerable.prototype.forEach = function (action) {
	        action = Utils.createLambda(action);

	        var index = 0;
	        var enumerator = this.getEnumerator();
	        try {
	            while (enumerator.moveNext()) {
	                if (action(enumerator.current(), index++) === false) break;
	            }
	        } finally {
	            Utils.dispose(enumerator);
	        }
	    };

	    // Overload:function()
	    // Overload:function(separator)
	    // Overload:function(separator,selector)
	    Enumerable.prototype.write = function (separator, selector) {
	        if (separator == null) separator = "";
	        selector = Utils.createLambda(selector);

	        var isFirst = true;
	        this.forEach(function (item) {
	            if (isFirst) isFirst = false;
	            else document.write(separator);
	            document.write(selector(item));
	        });
	    };

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.writeLine = function (selector) {
	        selector = Utils.createLambda(selector);

	        this.forEach(function (item) {
	            document.writeln(selector(item) + "<br />");
	        });
	    };

	    Enumerable.prototype.force = function () {
	        var enumerator = this.getEnumerator();

	        try {
	            while (enumerator.moveNext()) {
	            }
	        }
	        finally {
	            Utils.dispose(enumerator);
	        }
	    };

	    /* Functional Methods */

	    Enumerable.prototype.letBind = function (func) {
	        func = Utils.createLambda(func);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () {
	                    enumerator = Enumerable.from(func(source)).getEnumerator();
	                },
	                function () {
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.share = function () {
	        var source = this;
	        var sharedEnumerator;
	        var disposed = false;

	        return new DisposableEnumerable(function () {
	            return new IEnumerator(
	                function () {
	                    if (sharedEnumerator == null) {
	                        sharedEnumerator = source.getEnumerator();
	                    }
	                },
	                function () {
	                    if (disposed) throw new Error("enumerator is disposed");

	                    return (sharedEnumerator.moveNext())
	                        ? this.yieldReturn(sharedEnumerator.current())
	                        : false;
	                },
	                Functions.Blank
	            );
	        }, function () {
	            disposed = true;
	            Utils.dispose(sharedEnumerator);
	        });
	    };

	    Enumerable.prototype.memoize = function () {
	        var source = this;
	        var cache;
	        var enumerator;
	        var disposed = false;

	        return new DisposableEnumerable(function () {
	            var index = -1;

	            return new IEnumerator(
	                function () {
	                    if (enumerator == null) {
	                        enumerator = source.getEnumerator();
	                        cache = [];
	                    }
	                },
	                function () {
	                    if (disposed) throw new Error("enumerator is disposed");

	                    index++;
	                    if (cache.length <= index) {
	                        return (enumerator.moveNext())
	                            ? this.yieldReturn(cache[index] = enumerator.current())
	                            : false;
	                    }

	                    return this.yieldReturn(cache[index]);
	                },
	                Functions.Blank
	            );
	        }, function () {
	            disposed = true;
	            Utils.dispose(enumerator);
	            cache = null;
	        });
	    };

	    /* Error Handling Methods */

	    Enumerable.prototype.catchError = function (handler) {
	        handler = Utils.createLambda(handler);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    try {
	                        return (enumerator.moveNext())
	                            ? this.yieldReturn(enumerator.current())
	                            : false;
	                    } catch (e) {
	                        handler(e);
	                        return false;
	                    }
	                },
	                function () { Utils.dispose(enumerator); });
	        });
	    };

	    Enumerable.prototype.finallyAction = function (finallyAction) {
	        finallyAction = Utils.createLambda(finallyAction);
	        var source = this;

	        return new Enumerable(function () {
	            var enumerator;

	            return new IEnumerator(
	                function () { enumerator = source.getEnumerator(); },
	                function () {
	                    return (enumerator.moveNext())
	                        ? this.yieldReturn(enumerator.current())
	                        : false;
	                },
	                function () {
	                    try {
	                        Utils.dispose(enumerator);
	                    } finally {
	                        finallyAction();
	                    }
	                });
	        });
	    };

	    /* For Debug Methods */

	    // Overload:function()
	    // Overload:function(selector)
	    Enumerable.prototype.log = function (selector) {
	        selector = Utils.createLambda(selector);

	        return this.doAction(function (item) {
	            if (typeof console !== Types.Undefined) {
	                console.log(selector(item));
	            }
	        });
	    };

	    // Overload:function()
	    // Overload:function(message)
	    // Overload:function(message,selector)
	    Enumerable.prototype.trace = function (message, selector) {
	        if (message == null) message = "Trace";
	        selector = Utils.createLambda(selector);

	        return this.doAction(function (item) {
	            if (typeof console !== Types.Undefined) {
	                console.log(message, selector(item));
	            }
	        });
	    };

	    // private

	    var OrderedEnumerable = function (source, keySelector, descending, parent) {
	        this.source = source;
	        this.keySelector = Utils.createLambda(keySelector);
	        this.descending = descending;
	        this.parent = parent;
	    };
	    OrderedEnumerable.prototype = new Enumerable();

	    OrderedEnumerable.prototype.createOrderedEnumerable = function (keySelector, descending) {
	        return new OrderedEnumerable(this.source, keySelector, descending, this);
	    };

	    OrderedEnumerable.prototype.thenBy = function (keySelector) {
	        return this.createOrderedEnumerable(keySelector, false);
	    };

	    OrderedEnumerable.prototype.thenByDescending = function (keySelector) {
	        return this.createOrderedEnumerable(keySelector, true);
	    };

	    OrderedEnumerable.prototype.getEnumerator = function () {
	        var self = this;
	        var buffer;
	        var indexes;
	        var index = 0;

	        return new IEnumerator(
	            function () {
	                buffer = [];
	                indexes = [];
	                self.source.forEach(function (item, index) {
	                    buffer.push(item);
	                    indexes.push(index);
	                });
	                var sortContext = SortContext.create(self, null);
	                sortContext.GenerateKeys(buffer);

	                indexes.sort(function (a, b) { return sortContext.compare(a, b); });
	            },
	            function () {
	                return (index < indexes.length)
	                    ? this.yieldReturn(buffer[indexes[index++]])
	                    : false;
	            },
	            Functions.Blank
	        );
	    };

	    var SortContext = function (keySelector, descending, child) {
	        this.keySelector = keySelector;
	        this.descending = descending;
	        this.child = child;
	        this.keys = null;
	    };

	    SortContext.create = function (orderedEnumerable, currentContext) {
	        var context = new SortContext(orderedEnumerable.keySelector, orderedEnumerable.descending, currentContext);
	        if (orderedEnumerable.parent != null) return SortContext.create(orderedEnumerable.parent, context);
	        return context;
	    };

	    SortContext.prototype.GenerateKeys = function (source) {
	        var len = source.length;
	        var keySelector = this.keySelector;
	        var keys = new Array(len);
	        for (var i = 0; i < len; i++) keys[i] = keySelector(source[i]);
	        this.keys = keys;

	        if (this.child != null) this.child.GenerateKeys(source);
	    };

	    SortContext.prototype.compare = function (index1, index2) {
	        var comparison = Utils.compare(this.keys[index1], this.keys[index2]);

	        if (comparison == 0) {
	            if (this.child != null) return this.child.compare(index1, index2);
	            return Utils.compare(index1, index2);
	        }

	        return (this.descending) ? -comparison : comparison;
	    };

	    var DisposableEnumerable = function (getEnumerator, dispose) {
	        this.dispose = dispose;
	        Enumerable.call(this, getEnumerator);
	    };
	    DisposableEnumerable.prototype = new Enumerable();

	    // optimize array or arraylike object

	    var ArrayEnumerable = function (source) {
	        this.getSource = function () { return source; };
	    };
	    ArrayEnumerable.prototype = new Enumerable();

	    ArrayEnumerable.prototype.any = function (predicate) {
	        return (predicate == null)
	            ? (this.getSource().length > 0)
	            : Enumerable.prototype.any.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.count = function (predicate) {
	        return (predicate == null)
	            ? this.getSource().length
	            : Enumerable.prototype.count.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.elementAt = function (index) {
	        var source = this.getSource();
	        return (0 <= index && index < source.length)
	            ? source[index]
	            : Enumerable.prototype.elementAt.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.elementAtOrDefault = function (index, defaultValue) {
	        if (defaultValue === undefined) defaultValue = null;
	        var source = this.getSource();
	        return (0 <= index && index < source.length)
	            ? source[index]
	            : defaultValue;
	    };

	    ArrayEnumerable.prototype.first = function (predicate) {
	        var source = this.getSource();
	        return (predicate == null && source.length > 0)
	            ? source[0]
	            : Enumerable.prototype.first.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.firstOrDefault = function (predicate, defaultValue) {
	        if (defaultValue === undefined) defaultValue = null;
	        if (predicate != null) {
	            return Enumerable.prototype.firstOrDefault.apply(this, arguments);
	        }

	        var source = this.getSource();
	        return source.length > 0 ? source[0] : defaultValue;
	    };

	    ArrayEnumerable.prototype.last = function (predicate) {
	        var source = this.getSource();
	        return (predicate == null && source.length > 0)
	            ? source[source.length - 1]
	            : Enumerable.prototype.last.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.lastOrDefault = function (predicate, defaultValue) {
	        if (defaultValue === undefined) defaultValue = null;
	        if (predicate != null) {
	            return Enumerable.prototype.lastOrDefault.apply(this, arguments);
	        }

	        var source = this.getSource();
	        return source.length > 0 ? source[source.length - 1] : defaultValue;
	    };

	    ArrayEnumerable.prototype.skip = function (count) {
	        var source = this.getSource();

	        return new Enumerable(function () {
	            var index;

	            return new IEnumerator(
	                function () { index = (count < 0) ? 0 : count; },
	                function () {
	                    return (index < source.length)
	                        ? this.yieldReturn(source[index++])
	                        : false;
	                },
	                Functions.Blank);
	        });
	    };

	    ArrayEnumerable.prototype.takeExceptLast = function (count) {
	        if (count == null) count = 1;
	        return this.take(this.getSource().length - count);
	    };

	    ArrayEnumerable.prototype.takeFromLast = function (count) {
	        return this.skip(this.getSource().length - count);
	    };

	    ArrayEnumerable.prototype.reverse = function () {
	        var source = this.getSource();

	        return new Enumerable(function () {
	            var index;

	            return new IEnumerator(
	                function () {
	                    index = source.length;
	                },
	                function () {
	                    return (index > 0)
	                        ? this.yieldReturn(source[--index])
	                        : false;
	                },
	                Functions.Blank);
	        });
	    };

	    ArrayEnumerable.prototype.sequenceEqual = function (second, compareSelector) {
	        if ((second instanceof ArrayEnumerable || second instanceof Array)
	            && compareSelector == null
	            && Enumerable.from(second).count() != this.count()) {
	            return false;
	        }

	        return Enumerable.prototype.sequenceEqual.apply(this, arguments);
	    };

	    ArrayEnumerable.prototype.toJoinedString = function (separator, selector) {
	        var source = this.getSource();
	        if (selector != null || !(source instanceof Array)) {
	            return Enumerable.prototype.toJoinedString.apply(this, arguments);
	        }

	        if (separator == null) separator = "";
	        return source.join(separator);
	    };

	    ArrayEnumerable.prototype.getEnumerator = function () {
	        var source = this.getSource();
	        var index = -1;

	        // fast and simple enumerator
	        return {
	            current: function () { return source[index]; },
	            moveNext: function () {
	                return ++index < source.length;
	            },
	            dispose: Functions.Blank
	        };
	    };

	    // optimization for multiple where and multiple select and whereselect

	    var WhereEnumerable = function (source, predicate) {
	        this.prevSource = source;
	        this.prevPredicate = predicate; // predicate.length always <= 1
	    };
	    WhereEnumerable.prototype = new Enumerable();

	    WhereEnumerable.prototype.where = function (predicate) {
	        predicate = Utils.createLambda(predicate);

	        if (predicate.length <= 1) {
	            var prevPredicate = this.prevPredicate;
	            var composedPredicate = function (x) { return prevPredicate(x) && predicate(x); };
	            return new WhereEnumerable(this.prevSource, composedPredicate);
	        }
	        else {
	            // if predicate use index, can't compose
	            return Enumerable.prototype.where.call(this, predicate);
	        }
	    };

	    WhereEnumerable.prototype.select = function (selector) {
	        selector = Utils.createLambda(selector);

	        return (selector.length <= 1)
	            ? new WhereSelectEnumerable(this.prevSource, this.prevPredicate, selector)
	            : Enumerable.prototype.select.call(this, selector);
	    };

	    WhereEnumerable.prototype.getEnumerator = function () {
	        var predicate = this.prevPredicate;
	        var source = this.prevSource;
	        var enumerator;

	        return new IEnumerator(
	            function () { enumerator = source.getEnumerator(); },
	            function () {
	                while (enumerator.moveNext()) {
	                    if (predicate(enumerator.current())) {
	                        return this.yieldReturn(enumerator.current());
	                    }
	                }
	                return false;
	            },
	            function () { Utils.dispose(enumerator); });
	    };

	    var WhereSelectEnumerable = function (source, predicate, selector) {
	        this.prevSource = source;
	        this.prevPredicate = predicate; // predicate.length always <= 1 or null
	        this.prevSelector = selector; // selector.length always <= 1
	    };
	    WhereSelectEnumerable.prototype = new Enumerable();

	    WhereSelectEnumerable.prototype.where = function (predicate) {
	        predicate = Utils.createLambda(predicate);

	        return (predicate.length <= 1)
	            ? new WhereEnumerable(this, predicate)
	            : Enumerable.prototype.where.call(this, predicate);
	    };

	    WhereSelectEnumerable.prototype.select = function (selector) {
	        selector = Utils.createLambda(selector);

	        if (selector.length <= 1) {
	            var prevSelector = this.prevSelector;
	            var composedSelector = function (x) { return selector(prevSelector(x)); };
	            return new WhereSelectEnumerable(this.prevSource, this.prevPredicate, composedSelector);
	        }
	        else {
	            // if selector use index, can't compose
	            return Enumerable.prototype.select.call(this, selector);
	        }
	    };

	    WhereSelectEnumerable.prototype.getEnumerator = function () {
	        var predicate = this.prevPredicate;
	        var selector = this.prevSelector;
	        var source = this.prevSource;
	        var enumerator;

	        return new IEnumerator(
	            function () { enumerator = source.getEnumerator(); },
	            function () {
	                while (enumerator.moveNext()) {
	                    if (predicate == null || predicate(enumerator.current())) {
	                        return this.yieldReturn(selector(enumerator.current()));
	                    }
	                }
	                return false;
	            },
	            function () { Utils.dispose(enumerator); });
	    };

	    // Collections

	    var Dictionary = (function () {
	        // static utility methods
	        var callHasOwnProperty = function (target, key) {
	            return Object.prototype.hasOwnProperty.call(target, key);
	        };

	        var computeHashCode = function (obj) {
	            if (obj === null) return "null";
	            if (obj === undefined) return "undefined";

	            return (typeof obj.toString === Types.Function)
	                ? obj.toString()
	                : Object.prototype.toString.call(obj);
	        };

	        // LinkedList for Dictionary
	        var HashEntry = function (key, value) {
	            this.key = key;
	            this.value = value;
	            this.prev = null;
	            this.next = null;
	        };

	        var EntryList = function () {
	            this.first = null;
	            this.last = null;
	        };
	        EntryList.prototype =
	        {
	            addLast: function (entry) {
	                if (this.last != null) {
	                    this.last.next = entry;
	                    entry.prev = this.last;
	                    this.last = entry;
	                } else this.first = this.last = entry;
	            },

	            replace: function (entry, newEntry) {
	                if (entry.prev != null) {
	                    entry.prev.next = newEntry;
	                    newEntry.prev = entry.prev;
	                } else this.first = newEntry;

	                if (entry.next != null) {
	                    entry.next.prev = newEntry;
	                    newEntry.next = entry.next;
	                } else this.last = newEntry;

	            },

	            remove: function (entry) {
	                if (entry.prev != null) entry.prev.next = entry.next;
	                else this.first = entry.next;

	                if (entry.next != null) entry.next.prev = entry.prev;
	                else this.last = entry.prev;
	            }
	        };

	        // Overload:function()
	        // Overload:function(compareSelector)
	        var Dictionary = function (compareSelector) {
	            this.countField = 0;
	            this.entryList = new EntryList();
	            this.buckets = {}; // as Dictionary<string,List<object>>
	            this.compareSelector = (compareSelector == null) ? Functions.Identity : compareSelector;
	        };
	        Dictionary.prototype =
	        {
	            add: function (key, value) {
	                var compareKey = this.compareSelector(key);
	                var hash = computeHashCode(compareKey);
	                var entry = new HashEntry(key, value);
	                if (callHasOwnProperty(this.buckets, hash)) {
	                    var array = this.buckets[hash];
	                    for (var i = 0; i < array.length; i++) {
	                        if (this.compareSelector(array[i].key) === compareKey) {
	                            this.entryList.replace(array[i], entry);
	                            array[i] = entry;
	                            return;
	                        }
	                    }
	                    array.push(entry);
	                } else {
	                    this.buckets[hash] = [entry];
	                }
	                this.countField++;
	                this.entryList.addLast(entry);
	            },

	            get: function (key) {
	                var compareKey = this.compareSelector(key);
	                var hash = computeHashCode(compareKey);
	                if (!callHasOwnProperty(this.buckets, hash)) return undefined;

	                var array = this.buckets[hash];
	                for (var i = 0; i < array.length; i++) {
	                    var entry = array[i];
	                    if (this.compareSelector(entry.key) === compareKey) return entry.value;
	                }
	                return undefined;
	            },

	            set: function (key, value) {
	                var compareKey = this.compareSelector(key);
	                var hash = computeHashCode(compareKey);
	                if (callHasOwnProperty(this.buckets, hash)) {
	                    var array = this.buckets[hash];
	                    for (var i = 0; i < array.length; i++) {
	                        if (this.compareSelector(array[i].key) === compareKey) {
	                            var newEntry = new HashEntry(key, value);
	                            this.entryList.replace(array[i], newEntry);
	                            array[i] = newEntry;
	                            return true;
	                        }
	                    }
	                }
	                return false;
	            },

	            contains: function (key) {
	                var compareKey = this.compareSelector(key);
	                var hash = computeHashCode(compareKey);
	                if (!callHasOwnProperty(this.buckets, hash)) return false;

	                var array = this.buckets[hash];
	                for (var i = 0; i < array.length; i++) {
	                    if (this.compareSelector(array[i].key) === compareKey) return true;
	                }
	                return false;
	            },

	            clear: function () {
	                this.countField = 0;
	                this.buckets = {};
	                this.entryList = new EntryList();
	            },

	            remove: function (key) {
	                var compareKey = this.compareSelector(key);
	                var hash = computeHashCode(compareKey);
	                if (!callHasOwnProperty(this.buckets, hash)) return;

	                var array = this.buckets[hash];
	                for (var i = 0; i < array.length; i++) {
	                    if (this.compareSelector(array[i].key) === compareKey) {
	                        this.entryList.remove(array[i]);
	                        array.splice(i, 1);
	                        if (array.length == 0) delete this.buckets[hash];
	                        this.countField--;
	                        return;
	                    }
	                }
	            },

	            count: function () {
	                return this.countField;
	            },

	            toEnumerable: function () {
	                var self = this;
	                return new Enumerable(function () {
	                    var currentEntry;

	                    return new IEnumerator(
	                        function () { currentEntry = self.entryList.first; },
	                        function () {
	                            if (currentEntry != null) {
	                                var result = { key: currentEntry.key, value: currentEntry.value };
	                                currentEntry = currentEntry.next;
	                                return this.yieldReturn(result);
	                            }
	                            return false;
	                        },
	                        Functions.Blank);
	                });
	            }
	        };

	        return Dictionary;
	    })();

	    // dictionary = Dictionary<TKey, TValue[]>
	    var Lookup = function (dictionary) {
	        this.count = function () {
	            return dictionary.count();
	        };
	        this.get = function (key) {
	            return Enumerable.from(dictionary.get(key));
	        };
	        this.contains = function (key) {
	            return dictionary.contains(key);
	        };
	        this.toEnumerable = function () {
	            return dictionary.toEnumerable().select(function (kvp) {
	                return new Grouping(kvp.key, kvp.value);
	            });
	        };
	    };

	    var Grouping = function (groupKey, elements) {
	        this.key = function () {
	            return groupKey;
	        };
	        ArrayEnumerable.call(this, elements);
	    };
	    Grouping.prototype = new ArrayEnumerable();

	    // module export
	    if ("function" === Types.Function && __webpack_require__(16)) { // AMD
	        !(__WEBPACK_AMD_DEFINE_ARRAY__ = [], __WEBPACK_AMD_DEFINE_RESULT__ = function () { return Enumerable; }.apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__), __WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
	    }
	    else if (typeof module !== Types.Undefined && module.exports) { // Node
	        module.exports = Enumerable;
	    }
	    else {
	        root.Enumerable = Enumerable;
	    }
	})(this);


/***/ }),
/* 16 */
/***/ (function(module, exports) {

	/* WEBPACK VAR INJECTION */(function(__webpack_amd_options__) {module.exports = __webpack_amd_options__;

	/* WEBPACK VAR INJECTION */}.call(exports, {}))

/***/ }),
/* 17 */
/***/ (function(module, exports) {

	module.exports = require("events");

/***/ }),
/* 18 */
/***/ (function(module, exports) {

	module.exports = require("util");

/***/ })
/******/ ]);