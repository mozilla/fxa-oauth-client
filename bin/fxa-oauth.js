#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const P = require('bluebird');
const onError = require('../lib/error').onError;
const Client = require('../');
const log = require('npmlog');
const read = P.promisify(require('read'));

process.on('uncaughtException', onError);
log.pause();
log.heading = 'fxa';

var program = require('commander');

const ENVS = ['prod', 'stage', 'stable', 'nightly', 'latest'];
const URLS = {
  'prod': [
    'https://oauth.accounts.firefox.com',
    'https://api.accounts.firefox.com'
  ],
  'stage': [
    'https://oauth.stage.mozaws.net',
    'https://api-accounts.stage.mozaws.net'
  ],
  'stable': [
    'https://oauth-stable.dev.lcip.org',
    'https://stable.dev.lcip.org/auth'
  ],
  'nightly': [
    'https://oauth-nightly.dev.lcip.org',
    'https://nightly.dev.lcip.org/auth'
  ],
  'latest': [
    'https://oauth-latest.dev.lcip.org',
    'https://latest.dev.lcip.org/auth'
  ]
};

program
  .version(require('../package.json').version)
  .option(
    '-e, --env <env>',
    'Target a server environment: [' + ENVS.join(', ') + ']. Default: stable',
    function(env) {
      program.url = URLS[env][0];
      program.fxa = URLS[env][1];
    },
    'stable'
  )
  .option(
    '-u, --user <email>',
    'Env: FXA_USER',
    process.env.FXA_USER
  )
  .option(
    '--url <url>',
    'The base url of the OAuth server',
    URLS.stable[0]
  )
  .option(
    '--fxa <url>',
    'The base url of the Auth server',
    URLS.stable[1]
  )
  .option('-v, --verbose', 'Receive verbose output.', function() {
    log.level = 'verbose';
  });

function getPassword() {
  if (process.env.FXA_PASSWORD) {
    return P.resolve([process.env.FXA_PASSWORD]);
  } else {
    return read({
      prompt: 'Password:',
      silent: true
    });
  }
}

function makeClient() {
  log.resume();
  return getPassword().spread(function(password) {
    return new Client({
      email: program.user,
      password: password,
      oauthUrl: program.url,
      fxaUrl: program.fxa
    });
  });
}

program
  .command('token <clientId> <scope>')
  .description('Get an OAuth token.')
  .action(function(clientId, scope) {
    makeClient().then(function(client) {
      return client.getToken(clientId, scope);
    }).done(function(token) {
      log.verbose('token', token);
      /*jshint camelcase:false*/
      console.log('token:', token.access_token);
    }, onError);
  });

log.verbose('cli', 'process.argv', process.argv);
program.parse(process.argv);

if (!program.args.length) {
  program.help();
}
