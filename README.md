# FxA OAuth Client

A command line tool to ease interacting with the OAuth implementation of
Firefox Accounts.

```
  Usage: fxa-oauth [options] [command]


  Commands:

    token <clientId> <scope>              Get an OAuth token.
    clients                               List all clients.
    register                              Register a new OAuth client.
    update <clientId> <property> <value>  Update a property of a client.
    delete <clientId>                     Delete an OAuth client.

  Options:

    -h, --help          output usage information
    -V, --version       output the version number
    -e, --env <env>     Target a server environment: [prod, stage, stable, latest]. Default: stable
    -u, --user <email>  Env: FXA_USER
    --url <url>         The base url of the OAuth server
    --fxa <url>         The base url of the Auth server
    -v, --verbose       Receive verbose output.

```
