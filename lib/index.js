/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jshint camelcase:false*/

const P = require('bluebird');
const FxA = require('fxa-js-client');
const jwcrypto = P.promisifyAll(require('browserid-crypto'));
const signAssertion = P.promisify(jwcrypto.assertion.sign);
const log = require('npmlog');
const request = P.promisify(require('request'));
const url = require('url');
const xhr2 = require('xhr2');

require('browserid-crypto/lib/algs/ds');

const CERT_MS = 1000 * 60 * 60 * 10; // 10 minutes
const ASSERTION_MS = 1000 * 60 * 60 * 5; // 5 minutes

// we provide an xhr wrapper so we can log all http requests
function xhr() {
  var x = new xhr2();
  x.addEventListener('readystatechange', function() {
    if (this.readyState === this.OPENED) {
      log.http(this._method, this._url.href);
    } else if (this.readyState === this.DONE) {
      log.http(this.status, this._url.href);
    }
  });
  return x;
}

function assertion(secretKey, audience) {
  log.verbose('audience', audience);
  return signAssertion({}, {
    audience: audience,
    expiresAt: Date.now() + ASSERTION_MS
  }, secretKey);
}

function FxaError(props) {
  if (!(this instanceof FxaError)) {
    return new FxaError(props);
  }
  for (var k in props) {
    this[k] = props[k];
  }
  Error.captureStackTrace(this, FxaError);
}
FxaError.prototype = Object.create(Error.prototype);
FxaError.constructor = FxaError;

function wrapErr(e) {
  throw new FxaError(e);
}

function FxaOauthClient(options) {
  if (!(this instanceof FxaOauthClient)) {
    return new FxaOauthClient(options);
  }
  log.verbose('client', 'email', options.email);
  log.verbose('client', 'oauthUrl', options.oauthUrl);
  log.verbose('client', 'fxaUrl', options.fxaUrl);

  this._fxa = new FxA(options.fxaUrl, { xhr: xhr });
  this._email = options.email;
  this._password = options.password;
  this._baseUrl = options.oauthUrl;
  this._token = options.token;
}

FxaOauthClient.prototype = {

  listClients: function listClients() {
    return this._request({
      method: 'get',
      url: this._baseUrl + '/v1/clients',
      json: true,
      headers: {
        authorization: 'Bearer ' + this._token
      }
    });
  },

  getClient: function getClient(id) {
    return this._request({
      method: 'get',
      url: this._baseUrl + '/v1/client/' + id
    });
  },

  registerClient: function registerClient(client) {
    return this._request({
      method: 'post',
      url: this._baseUrl + '/v1/client',
      headers: {
        authorization: 'Bearer ' + this._token
      },
      json: client
    });
  },

  updateClient: function updateClient(client) {
    return this._request({
      method: 'post',
      url: this._baseUrl + '/v1/client/' + client.id,
      headers: {
        authorization: 'Bearer ' + this._token
      },
      json: client
    });
  },

  deleteClient: function deleteClient(clientId) {
    return this._request({
      method: 'delete',
      url: this._baseUrl + '/v1/client/' + clientId,
      headers: {
        authorization: 'Bearer ' + this._token
      }
    });
  },

  getToken: function getToken(clientId, scope) {
    var that = this;
    log.verbose('getToken', 'clientId', clientId);
    log.verbose('getToken', 'scope', scope);
    var state = require('crypto').randomBytes(8).toString('hex');
    return this._getAssertion()
      .then(function(assertion) {
        log.silly('assertion', assertion);
        return that._request({
          method: 'post',
          url: that._baseUrl + '/v1/authorization',
          json: {
            assertion: assertion,
            scope: scope,
            response_type: 'token', // implicit grant token
            state: state,
            client_id: clientId
          }
        });
      });
  },

  destroyToken: function destroyToken(token) {
    return this._request({
      method: 'post',
      url: this._baseUrl + '/v1/destroy',
      json: {
        token: token
      },
      headers: {
        authorization: 'Bearer ' + this._token
      }
    });
  },

  _getAssertion: function _getAssertion() {
    var that = this;
    return this._fxa.signIn(this._email, this._password).then(null, wrapErr)
      .then(function(res) {
        log.silly('auth', 'signIn', res);
        return P.all([res.sessionToken, jwcrypto.generateKeypairAsync({
          algorithm: 'DS',
          keysize: 128
        })]);
      }).spread(function(sessionToken, keypair) {
        log.verbose('jwcrypto', 'keypair generated');
        var parsed = url.parse(that._baseUrl);
        var aud = parsed.protocol + '//' + parsed.host;
        return P.all([
          that._fxa.certificateSign(
            sessionToken,
            keypair.publicKey.toSimpleObject(),
            CERT_MS
          ).then(null, wrapErr),
          assertion(keypair.secretKey, aud)
        ]);
      }).spread(function(cert, assertion) {
        log.verbose('cert and assertion');
        return jwcrypto.cert.bundle([cert.cert], assertion);
      });
  },

  _request: function _request(options) {
    log.http(options.method.toUpperCase(), options.url);
    return request(options).spread(function(res, body) {
      log.http(res.statusCode, options.url);
      if (res.statusCode >= 200 && res.statusCode < 400) {
        return body;
      } else {
        log.verbose(res.statusCode, body);
        throw FxaError(body);
      }
    });
  }
};

module.exports = FxaOauthClient;
