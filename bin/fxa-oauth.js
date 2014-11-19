#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const P = require('bluebird');
const error = require('../lib/error');
const onError = error.onError;
const Client = require('../');
const log = require('npmlog');
const read = P.promisify(require('read'));

// CLI id that should be in each environment
const CLI_CLIENT_ID = '66041b7ec3991ec0';

P.onPossiblyUnhandledRejection(function(e) { 
  throw e;
});
process.on('uncaughtException', onError);
log.pause();
log.heading = 'fxa';

var program = require('commander');

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
  'latest': [
    'https://oauth-latest.dev.lcip.org',
    'https://latest.dev.lcip.org/auth'
  ]
};
const ENVS = Object.keys(URLS);

function toBoolean(val) {
  val = val.toLowerCase();
  if (typeof val === 'string') {
    return val === 'y' || val === 'yes' || val === 't' || val === 'true';
  } else {
    return !!val;
  }
}

// Print important information to the user, such as prompting for
// information, or outputting the end result. All valuse are
// additionally logged verbosely, so we can see what was shown to the
// user if there is an error.
function p() {
  log.silly('p', [].slice.call(arguments));
  console.log.apply(console, arguments);
}

program
  .version(require('../package.json').version)
  .option(
    '-e, --env <env>',
    'Target a server environment: [' + ENVS.join(', ') + ']. Default: stable',
    function(env) {
      log.info('env', env);
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
  })
  .option('-q, --quiet', 'Reduce output to errors and warnings.', function() {
    log.level = 'warn';
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
  error.assert(program.fxa, '--fxa or --env');
  error.assert(program.url, '--url or --env');
  error.assert(program.user, '-u or --user');
  log.info('user', program.user);
  return getPassword().spread(function(password) {
    error.assert(password, 'password cannot be blank');
    return new Client({
      email: program.user,
      password: password,
      oauthUrl: program.url,
      fxaUrl: program.fxa
    });
  });
}

function withTempToken(cb) {
  return P.using(makeClient().then(function(client) {
    log.verbose('token', 'client created');
    return P.cast(client.getToken(CLI_CLIENT_ID, 'oauth')
      .then(function(token) {
        log.verbose('token', 'temp token stored');
        /*jshint camelcase:false*/
        client._token = error._tempToken = token.access_token;
        return client;
      })).disposer(function() {
        if (error._tempToken) {
          log.verbose('token', 'temp token found, deleting');
          return client.destroyToken(error._tempToken)
            .done(function() {
              log.verbose('token', 'deleted temporary token');
              delete error._tempToken;
            }, error.onError);
        }
      });
  }), cb);
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
      p('token:', token.access_token);
    }, onError);
  });

program
  .command('clients')
  .description('List all clients.')
  .action(function() {
    withTempToken(function(client) {
      /*jshint camelcase:false*/
      return client.listClients()
        .done(function(clients) {
          p(JSON.stringify(clients.clients, null, 2));
        }, onError);
    });
  });

function promptClient() {
  var results = {};
  /*jshint camelcase:false*/
  var schema = {
    name: {},
    redirect_uri: {},
    image_uri: {},
    whitelisted: {
      default: 'true'
    },
    can_grant: {
      prompt: 'Implicit grant permission?',
      default: 'false'
    }
  };
  var prompts = Object.keys(schema);

  function prompt(name) {
    var opts = schema[name];
    if (!opts.prompt) {
      opts.prompt = name + ':';
    }
    return read(opts).spread(function(input) {
      if (input) {
        results[name] = input;
      }
    });
  }

  return P.map(prompts, prompt, { concurrency: 1 }).then(function() {
    return results;
  });
}

program
  .command('register')
  .description('Register a new OAuth client.')
  .action(function() {
    p('Fill in client details...');
    return promptClient().then(function(client) {
      log.verbose('register', 'client', client);
      p('Registering client:', JSON.stringify(client, null, 2));
      p('');
      return read({
        prompt: 'Is this correct?',
        default: 'no'
      }).spread(function(answer) {
        if (toBoolean(answer)) {
          return withTempToken(function(oauth) {
            return oauth.registerClient(client);
          });
        }
      });
    }).done(function(client) {
      log.verbose('register', 'complete', client);
      p('Client registered:', JSON.stringify(client, null, 2));
    }, onError);
  });

program
  .command('update <clientId> <property> <value>')
  .description('Update a property of a client.')
  .action(function(id, prop, value) {
    //TODO: validate id,prop,value
    withTempToken(function(oauth) {
      var client = { id: id };
      client[prop] = value;
      return oauth.updateClient(client)
        .done(function() {
          log.info('update', 'Client %s updated %s="%s".', id, prop, value);
        }, onError);
    });
  });

program
  .command('delete <clientId>')
  .description('Delete an OAuth client.')
  .action(function(id) {
    withTempToken(function(oauth) {
      return oauth.getClient(id)
        .then(function(client) {
          p('Delete ', JSON.stringify(client, null, 2));
          return read({
            prompt: 'Are you sure? y/n?',
            default: 'n'
          });
        })
        .spread(function(answer) {
          if (toBoolean(answer)) {
            log.info('delete-client', 'yes');
            return oauth.deleteClient(id).then(function(res) {
              log.verbose('delete-client', res);
              return true;
            });
          } else {
            log.info('delete-client', answer);
            return P.resolve(false);
          }
        })
        .done(function(wasDeleted) {
          if (wasDeleted) {
            p('Client %s deleted.', id);
          } else {
            p('Aborted.');
          }
        }, onError);
    });
  });

log.verbose('cli', 'process.argv', process.argv);
program.parse(process.argv);

if (!program.args.length) {
  program.help();
}
