require("requirish")._(module);

const OPCUAServer = require("lib/server/opcua_server").OPCUAServer;

const util = require("util");
const async = require("async");
const _ = require("underscore");
const assert = require("better-assert");
const debugLog = require("lib/misc/utils").make_debugLog(__filename);

const s = require("lib/datamodel/structures");
const OPCUAServerEndPoint = require("lib/server/server_end_point").OPCUAServerEndPoint;
const StatusCodes = require("lib/datamodel/opcua_status_code").StatusCodes;

const register_server_service = require("lib/services/register_server_service");
const RegisterServerRequest = register_server_service.RegisterServerRequest;
const RegisterServerResponse = register_server_service.RegisterServerResponse;
const FindServersRequest = register_server_service.FindServersRequest;
const FindServersResponse = register_server_service.FindServersResponse;

const endpoints_service = require("lib/services/get_endpoints_service");
const ApplicationDescription = endpoints_service.ApplicationDescription;
const ApplicationType = endpoints_service.ApplicationType;

const get_fully_qualified_domain_name = require("lib/misc/hostname").get_fully_qualified_domain_name;
const constructFilename = require("lib/misc/utils").constructFilename;
const OPCUABaseServer = require("lib/server/base_server").OPCUABaseServer;

const makeApplicationUrn = require("lib/misc/applicationurn").makeApplicationUrn;

function OPCUADiscoveryServer(options) {

    const self = this;

    const default_certificate_file = constructFilename("certificates/discoveryServer_cert_2048.pem");
    options.certificateFile = options.certificateFile || default_certificate_file;

    const default_private_key_file = constructFilename("certificates/discoveryServer_key_2048.pem");
    options.privateKeyFile = options.privateKeyFile || default_private_key_file;

    const defaultApplicationUri = makeApplicationUrn(get_fully_qualified_domain_name(), "NodeOPCUA-DiscoveryServer");

    OPCUABaseServer.apply(this, arguments);

    const serverInfo = options.serverInfo || {};

    serverInfo.applicationType = s.ApplicationType.DISCOVERYSERVER;
    serverInfo.applicationUri = serverInfo.applicationUri || defaultApplicationUri;
    serverInfo.productUri = serverInfo.productUri || "SampleDiscoveryServer";
    serverInfo.applicationName = serverInfo.applicationName || {text: "SampleDiscoveryServer", locale: null};
    serverInfo.gatewayServerUri = serverInfo.gatewayServerUri || "";
    serverInfo.discoveryProfileUri = serverInfo.discoveryProfileUri || "";
    serverInfo.discoveryUrls = serverInfo.discoveryUrls || [];

    self.serverInfo = serverInfo;

    const port = options.port || 4840;

    self.registered_servers = {};
    // see OPC UA Spec 1.2 part 6 : 7.4 Well Known Addresses
    // opc.tcp://localhost:4840/UADiscovery

    const endPoint = new OPCUAServerEndPoint({
        port,
        certificateChain: self.getCertificateChain(),
        privateKey: self.getPrivateKey(),
        serverInfo: self.serverInfo
    });
    endPoint.addStandardEndpointDescriptions();

    self.endpoints.push(endPoint);

    endPoint.on("message", (message, channel) => {
        self.on_request(message, channel);
    });
}

util.inherits(OPCUADiscoveryServer, OPCUABaseServer);

OPCUADiscoveryServer.prototype.start = function (done) {
    OPCUABaseServer.prototype.start.call(this, done);
};


OPCUADiscoveryServer.prototype.shutdown = OPCUABaseServer.prototype.shutdown;

/*== private
 * returns true if the serverType can be added to a discovery server.
 * @param serverType
 * @return {boolean}
 * @private
 */
function _isValideServerType(serverType) {

    switch (serverType) {
        case ApplicationType.CLIENT:
            return false;
        case ApplicationType.SERVER:
        case ApplicationType.CLIENTANDSERVER:
        case ApplicationType.DISCOVERYSERVER:
            return true;
    }
    return false;
}

OPCUADiscoveryServer.prototype._on_RegisterServerRequest = function (message, channel) {
    const server = this;
    const request = message.request;

    assert(request._schema.name === "RegisterServerRequest");
    assert(request instanceof RegisterServerRequest);

    function sendError(statusCode) {
        console.log("_on_RegisterServerRequest error".red, statusCode.toString());
        const response = new RegisterServerResponse({responseHeader: {serviceResult: statusCode}});
        return channel.send_response("MSG", response, message);
    }

    // check serverType is valid
    if (!_isValideServerType(request.server.serverType)) {
        return sendError(StatusCodes.BadInvalidArgument);
    }

    // BadServerUriInvalid
    // TODO

    // BadServerNameMissing
    if (request.server.serverNames.length === 0) {
        return sendError(StatusCodes.BadServerNameMissing);
    }

    // BadDiscoveryUrlMissing
    if (request.server.discoveryUrls.length === 0) {
        return sendError(StatusCodes.BadDiscoveryUrlMissing);
    }

    const key = request.server.serverUri;

    if (request.server.isOnline) {
        console.log(" registering server : ".cyan, request.server.serverUri.yellow);
        server.registered_servers[key] = request.server;

        // prepare serverInfo which will be used by FindServers
        const serverInfo = {};
        serverInfo.applicationUri = serverInfo.serverUri;
        serverInfo.applicationType = request.server.serverType;
        serverInfo.productUri = request.server.productUri;
        serverInfo.applicationName = request.server.serverNames[0]; // which one shall we use ?
        serverInfo.gatewayServerUri = request.server.gatewayServerUri;
        // XXX ?????? serverInfo.discoveryProfileUri = serverInfo.discoveryProfileUri;
        serverInfo.discoveryUrls = request.server.discoveryUrls;
        server.registered_servers[key].serverInfo = serverInfo;

    } else {
        if (key in server.registered_servers) {
            console.log(" unregistering server : ".cyan, request.server.serverUri.yellow);
            delete server.registered_servers[key];
        }
    }

    const response = new RegisterServerResponse({});
    channel.send_response("MSG", response, message);
};

OPCUADiscoveryServer.prototype.__defineGetter__("registeredServerCount", function () {
    return Object.keys(this.registered_servers).length;
});

//OPCUADiscoveryServer.prototype.getDiscoveryUrls = function(channel) {
//
//    var self = this;
//    assert(channel);
//
//    var discoveryUrls = OPCUABaseServer.prototype.getDiscoveryUrls.call(this,channel);
//    // add registered server Urls
//    _.forEach(self.registered_servers,function(registered_server){
//        discoveryUrls = discoveryUrls.concat(registered_server.discoveryUrls);
//    });
//    return discoveryUrls;
//};

OPCUADiscoveryServer.prototype.getServers = function (channel) {
    const self = this;
    self.serverInfo.discoveryUrls = self.getDiscoveryUrls(channel);
    const servers = [self.serverInfo];
    _.forEach(self.registered_servers, registered_server => {
        servers.push(registered_server.serverInfo);
    });

    return servers;
};

exports.OPCUADiscoveryServer = OPCUADiscoveryServer;