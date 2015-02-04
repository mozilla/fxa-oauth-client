/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const log = require('npmlog');

function CliError(options) {
  Error.call(this);
  if (options.stack) {
    this.stack = options.stack;
  } else {
    Error.captureStackTrace(this, CliError);
  }
  this.name = options.name;
  this.code = options.code;
  this.errno = options.errno;
  this.message = options.message;
}
CliError.prototype = Object.create(Error.prototype);

// W101 is `Line too long`
/*jshint -W101*/
const AUTH_INFO = 'https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#response-format';
const OAUTH_INFO = 'https://github.com/mozilla/fxa-oauth-server/blob/master/docs/api.md#errors';
/*jshint +W101*/

CliError.auth = function authError(options) {
  return new CliError({
    name: 'Auth',
    code: options.code,
    errno: options.errno,
    message: options.message
  });
};

CliError.oauth = function oauthError(options) {
  return new CliError({
    name: 'OAuth',
    code: options.code,
    errno: options.errno,
    message: options.message
  });
};

CliError.required = function requiredError(msg) {
  return new CliError({
    name: 'Required',
    code: 'EREQUIRED',
    errno: 100,
    message: msg
  });
};

CliError.weird = function weirdError(obj) {
  return new CliError({
    name: obj.name || 'Weird',
    code: 'EWEIRD',
    errno: 999,
    stack: obj.stack,
    message: obj.message
  });
};


function translate(obj) {
  if (!obj) {
    return CliError.weird({ message: 'Error undefined' });
  }
  if (obj instanceof CliError) {
    return obj;
  }

  if (obj.info === AUTH_INFO) {
    log.silly('auth error', obj);
    return CliError.auth(obj);
  } else if (obj.info === OAUTH_INFO) {
    log.silly('oauth error', obj);
    return CliError.oauth(obj);
  }

  log.silly('weird error', JSON.stringify(obj));
  return CliError.weird(obj);
}

function onExit(code) {
  if (CliError._tempToken) {
    log.error('token', 'temporary token was not cleaned up!');
    log.error('token', CliError._tempToken);
    log.error('token', 'Make sure the above token is deleted from the server');
    if (!code) {
      code = 'ETOKEN';
    }
  }
  if (code) {
    log.error('argv', process.argv);
    log.error('--version', require('../package.json').version);
    log.error('code', code);

    var out = '';
    log.record.forEach(function(m) {
      var pref = [m.id, m.level];
      if (m.prefix) {
        pref.push(m.prefix);
      }
      pref = pref.join(' ');
      m.message.trim().split(/\r?\n/).map(function(line) {
        return (pref + ' ' + line).trim();
      }).forEach(function(line) {
        out += line + os.EOL;
      });
    });
    fs.writeFileSync('fxa-debug.log', out);
    log.error('', 'Additional logging details can be found in:');
    log.error('', '    ', path.resolve('fxa-debug.log'));
  } else {
    if (fs.existsSync('fxa-debug.log')) {
      fs.unlinkSync('fxa-debug.log');
    }
    log.info('ok');
  }
}

process.on('exit', onExit);

module.exports = CliError;

CliError.onError = function onError(err) {
  err = translate(err);

  switch (err.name) {
    case 'Required':
      log.error('cli', 'A required parameter was not provided:', err.message);
      break;
    case 'Auth':
      log.error('auth', err.message);
      break;
    case 'OAuth':
      log.error('oauth', err.message);
      break;
  }
  log.silly('cli', err.stack);

  process.exit(err.code);
};

CliError.assert = function assert(expr, msg) {
  if (!expr) {
    throw CliError.required(msg);
  }
};
