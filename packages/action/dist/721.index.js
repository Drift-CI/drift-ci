export const id = 721;
export const ids = [721,404,898,646,568];
export const modules = {

/***/ 88542:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var propertyProvider = __webpack_require__(73798);

function resolveLogins(logins) {
    return Promise.all(Object.keys(logins).reduce((arr, name) => {
        const tokenOrProvider = logins[name];
        if (typeof tokenOrProvider === "string") {
            arr.push([name, tokenOrProvider]);
        }
        else {
            arr.push(tokenOrProvider().then((token) => [name, token]));
        }
        return arr;
    }, [])).then((resolvedPairs) => resolvedPairs.reduce((logins, [key, value]) => {
        logins[key] = value;
        return logins;
    }, {}));
}

function fromCognitoIdentity(parameters) {
    return async (awsIdentityProperties) => {
        parameters.logger?.debug("@aws-sdk/credential-provider-cognito-identity - fromCognitoIdentity");
        const { GetCredentialsForIdentityCommand, CognitoIdentityClient } = await Promise.resolve().then(function () { return __webpack_require__(72591); });
        const fromConfigs = (property) => parameters.clientConfig?.[property] ??
            parameters.parentClientConfig?.[property] ??
            awsIdentityProperties?.callerClientConfig?.[property];
        const { Credentials: { AccessKeyId = throwOnMissingAccessKeyId(parameters.logger), Expiration, SecretKey = throwOnMissingSecretKey(parameters.logger), SessionToken, } = throwOnMissingCredentials(parameters.logger), } = await (parameters.client ??
            new CognitoIdentityClient(Object.assign({}, parameters.clientConfig ?? {}, {
                region: fromConfigs("region"),
                profile: fromConfigs("profile"),
                userAgentAppId: fromConfigs("userAgentAppId"),
            }))).send(new GetCredentialsForIdentityCommand({
            CustomRoleArn: parameters.customRoleArn,
            IdentityId: parameters.identityId,
            Logins: parameters.logins ? await resolveLogins(parameters.logins) : undefined,
        }));
        return {
            identityId: parameters.identityId,
            accessKeyId: AccessKeyId,
            secretAccessKey: SecretKey,
            sessionToken: SessionToken,
            expiration: Expiration,
        };
    };
}
function throwOnMissingAccessKeyId(logger) {
    throw new propertyProvider.CredentialsProviderError("Response from Amazon Cognito contained no access key ID", { logger });
}
function throwOnMissingCredentials(logger) {
    throw new propertyProvider.CredentialsProviderError("Response from Amazon Cognito contained no credentials", { logger });
}
function throwOnMissingSecretKey(logger) {
    throw new propertyProvider.CredentialsProviderError("Response from Amazon Cognito contained no secret key", { logger });
}

const STORE_NAME = "IdentityIds";
class IndexedDbStorage {
    dbName;
    constructor(dbName = "aws:cognito-identity-ids") {
        this.dbName = dbName;
    }
    getItem(key) {
        return this.withObjectStore("readonly", (store) => {
            const req = store.get(key);
            return new Promise((resolve) => {
                req.onerror = () => resolve(null);
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
            });
        }).catch(() => null);
    }
    removeItem(key) {
        return this.withObjectStore("readwrite", (store) => {
            const req = store.delete(key);
            return new Promise((resolve, reject) => {
                req.onerror = () => reject(req.error);
                req.onsuccess = () => resolve();
            });
        });
    }
    setItem(id, value) {
        return this.withObjectStore("readwrite", (store) => {
            const req = store.put({ id, value });
            return new Promise((resolve, reject) => {
                req.onerror = () => reject(req.error);
                req.onsuccess = () => resolve();
            });
        });
    }
    getDb() {
        const openDbRequest = self.indexedDB.open(this.dbName, 1);
        return new Promise((resolve, reject) => {
            openDbRequest.onsuccess = () => {
                resolve(openDbRequest.result);
            };
            openDbRequest.onerror = () => {
                reject(openDbRequest.error);
            };
            openDbRequest.onblocked = () => {
                reject(new Error("Unable to access DB"));
            };
            openDbRequest.onupgradeneeded = () => {
                const db = openDbRequest.result;
                db.onerror = () => {
                    reject(new Error("Failed to create object store"));
                };
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            };
        });
    }
    withObjectStore(mode, action) {
        return this.getDb().then((db) => {
            const tx = db.transaction(STORE_NAME, mode);
            tx.oncomplete = () => db.close();
            return new Promise((resolve, reject) => {
                tx.onerror = () => reject(tx.error);
                resolve(action(tx.objectStore(STORE_NAME)));
            }).catch((err) => {
                db.close();
                throw err;
            });
        });
    }
}

class InMemoryStorage {
    store;
    constructor(store = {}) {
        this.store = store;
    }
    getItem(key) {
        if (key in this.store) {
            return this.store[key];
        }
        return null;
    }
    removeItem(key) {
        delete this.store[key];
    }
    setItem(key, value) {
        this.store[key] = value;
    }
}

const inMemoryStorage = new InMemoryStorage();
function localStorage() {
    if (typeof self === "object" && self.indexedDB) {
        return new IndexedDbStorage();
    }
    if (typeof window === "object" && window.localStorage) {
        return window.localStorage;
    }
    return inMemoryStorage;
}

function fromCognitoIdentityPool({ accountId, cache = localStorage(), client, clientConfig, customRoleArn, identityPoolId, logins, userIdentifier = !logins || Object.keys(logins).length === 0 ? "ANONYMOUS" : undefined, logger, parentClientConfig, }) {
    logger?.debug("@aws-sdk/credential-provider-cognito-identity - fromCognitoIdentity");
    const cacheKey = userIdentifier
        ? `aws:cognito-identity-credentials:${identityPoolId}:${userIdentifier}`
        : undefined;
    let provider = async (awsIdentityProperties) => {
        const { GetIdCommand, CognitoIdentityClient } = await Promise.resolve().then(function () { return __webpack_require__(72591); });
        const fromConfigs = (property) => clientConfig?.[property] ??
            parentClientConfig?.[property] ??
            awsIdentityProperties?.callerClientConfig?.[property];
        const _client = client ??
            new CognitoIdentityClient(Object.assign({}, clientConfig ?? {}, {
                region: fromConfigs("region"),
                profile: fromConfigs("profile"),
                userAgentAppId: fromConfigs("userAgentAppId"),
            }));
        let identityId = (cacheKey && (await cache.getItem(cacheKey)));
        if (!identityId) {
            const { IdentityId = throwOnMissingId(logger) } = await _client.send(new GetIdCommand({
                AccountId: accountId,
                IdentityPoolId: identityPoolId,
                Logins: logins ? await resolveLogins(logins) : undefined,
            }));
            identityId = IdentityId;
            if (cacheKey) {
                Promise.resolve(cache.setItem(cacheKey, identityId)).catch(() => { });
            }
        }
        provider = fromCognitoIdentity({
            client: _client,
            customRoleArn,
            logins,
            identityId,
        });
        return provider(awsIdentityProperties);
    };
    return (awsIdentityProperties) => provider(awsIdentityProperties).catch(async (err) => {
        if (cacheKey) {
            Promise.resolve(cache.removeItem(cacheKey)).catch(() => { });
        }
        throw err;
    });
}
function throwOnMissingId(logger) {
    throw new propertyProvider.CredentialsProviderError("Response from Amazon Cognito contained no identity ID", { logger });
}

exports.fromCognitoIdentity = fromCognitoIdentity;
exports.fromCognitoIdentityPool = fromCognitoIdentityPool;


/***/ }),

/***/ 72591:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var cognitoIdentity = __webpack_require__(51865);



exports.CognitoIdentityClient = cognitoIdentity.CognitoIdentityClient;
exports.GetCredentialsForIdentityCommand = cognitoIdentity.GetCredentialsForIdentityCommand;
exports.GetIdCommand = cognitoIdentity.GetIdCommand;


/***/ }),

/***/ 65018:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.checkUrl = void 0;
const property_provider_1 = __webpack_require__(73798);
const LOOPBACK_CIDR_IPv4 = "127.0.0.0/8";
const LOOPBACK_CIDR_IPv6 = "::1/128";
const ECS_CONTAINER_HOST = "169.254.170.2";
const EKS_CONTAINER_HOST_IPv4 = "169.254.170.23";
const EKS_CONTAINER_HOST_IPv6 = "[fd00:ec2::23]";
const checkUrl = (url, logger) => {
    if (url.protocol === "https:") {
        return;
    }
    if (url.hostname === ECS_CONTAINER_HOST ||
        url.hostname === EKS_CONTAINER_HOST_IPv4 ||
        url.hostname === EKS_CONTAINER_HOST_IPv6) {
        return;
    }
    if (url.hostname.includes("[")) {
        if (url.hostname === "[::1]" || url.hostname === "[0000:0000:0000:0000:0000:0000:0000:0001]") {
            return;
        }
    }
    else {
        if (url.hostname === "localhost") {
            return;
        }
        const ipComponents = url.hostname.split(".");
        const inRange = (component) => {
            const num = parseInt(component, 10);
            return 0 <= num && num <= 255;
        };
        if (ipComponents[0] === "127" &&
            inRange(ipComponents[1]) &&
            inRange(ipComponents[2]) &&
            inRange(ipComponents[3]) &&
            ipComponents.length === 4) {
            return;
        }
    }
    throw new property_provider_1.CredentialsProviderError(`URL not accepted. It must either be HTTPS or match one of the following:
  - loopback CIDR 127.0.0.0/8 or [::1/128]
  - ECS container host 169.254.170.2
  - EKS container host 169.254.170.23 or [fd00:ec2::23]`, { logger });
};
exports.checkUrl = checkUrl;


/***/ }),

/***/ 30439:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromHttp = void 0;
const tslib_1 = __webpack_require__(21440);
const client_1 = __webpack_require__(54997);
const node_http_handler_1 = __webpack_require__(55604);
const property_provider_1 = __webpack_require__(73798);
const promises_1 = tslib_1.__importDefault(__webpack_require__(51455));
const checkUrl_1 = __webpack_require__(65018);
const requestHelpers_1 = __webpack_require__(86825);
const retry_wrapper_1 = __webpack_require__(9059);
const AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
const DEFAULT_LINK_LOCAL_HOST = "http://169.254.170.2";
const AWS_CONTAINER_CREDENTIALS_FULL_URI = "AWS_CONTAINER_CREDENTIALS_FULL_URI";
const AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE = "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE";
const AWS_CONTAINER_AUTHORIZATION_TOKEN = "AWS_CONTAINER_AUTHORIZATION_TOKEN";
const fromHttp = (options = {}) => {
    options.logger?.debug("@aws-sdk/credential-provider-http - fromHttp");
    let host;
    const relative = options.awsContainerCredentialsRelativeUri ?? process.env[AWS_CONTAINER_CREDENTIALS_RELATIVE_URI];
    const full = options.awsContainerCredentialsFullUri ?? process.env[AWS_CONTAINER_CREDENTIALS_FULL_URI];
    const token = options.awsContainerAuthorizationToken ?? process.env[AWS_CONTAINER_AUTHORIZATION_TOKEN];
    const tokenFile = options.awsContainerAuthorizationTokenFile ?? process.env[AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE];
    const warn = options.logger?.constructor?.name === "NoOpLogger" || !options.logger?.warn
        ? console.warn
        : options.logger.warn.bind(options.logger);
    if (relative && full) {
        warn("@aws-sdk/credential-provider-http: " +
            "you have set both awsContainerCredentialsRelativeUri and awsContainerCredentialsFullUri.");
        warn("awsContainerCredentialsFullUri will take precedence.");
    }
    if (token && tokenFile) {
        warn("@aws-sdk/credential-provider-http: " +
            "you have set both awsContainerAuthorizationToken and awsContainerAuthorizationTokenFile.");
        warn("awsContainerAuthorizationToken will take precedence.");
    }
    if (full) {
        host = full;
    }
    else if (relative) {
        host = `${DEFAULT_LINK_LOCAL_HOST}${relative}`;
    }
    else {
        throw new property_provider_1.CredentialsProviderError(`No HTTP credential provider host provided.
Set AWS_CONTAINER_CREDENTIALS_FULL_URI or AWS_CONTAINER_CREDENTIALS_RELATIVE_URI.`, { logger: options.logger });
    }
    const url = new URL(host);
    (0, checkUrl_1.checkUrl)(url, options.logger);
    const requestHandler = node_http_handler_1.NodeHttpHandler.create({
        requestTimeout: options.timeout ?? 1000,
        connectionTimeout: options.timeout ?? 1000,
    });
    return (0, retry_wrapper_1.retryWrapper)(async () => {
        const request = (0, requestHelpers_1.createGetRequest)(url);
        if (token) {
            request.headers.Authorization = token;
        }
        else if (tokenFile) {
            request.headers.Authorization = (await promises_1.default.readFile(tokenFile)).toString();
        }
        try {
            const result = await requestHandler.handle(request);
            return (0, requestHelpers_1.getCredentials)(result.response).then((creds) => (0, client_1.setCredentialFeature)(creds, "CREDENTIALS_HTTP", "z"));
        }
        catch (e) {
            throw new property_provider_1.CredentialsProviderError(String(e), { logger: options.logger });
        }
    }, options.maxRetries ?? 3, options.timeout ?? 1000);
};
exports.fromHttp = fromHttp;


/***/ }),

/***/ 86825:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.createGetRequest = createGetRequest;
exports.getCredentials = getCredentials;
const property_provider_1 = __webpack_require__(73798);
const protocol_http_1 = __webpack_require__(38578);
const smithy_client_1 = __webpack_require__(47040);
const util_stream_1 = __webpack_require__(72429);
function createGetRequest(url) {
    return new protocol_http_1.HttpRequest({
        protocol: url.protocol,
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname,
        query: Array.from(url.searchParams.entries()).reduce((acc, [k, v]) => {
            acc[k] = v;
            return acc;
        }, {}),
        fragment: url.hash,
    });
}
async function getCredentials(response, logger) {
    const stream = (0, util_stream_1.sdkStreamMixin)(response.body);
    const str = await stream.transformToString();
    if (response.statusCode === 200) {
        const parsed = JSON.parse(str);
        if (typeof parsed.AccessKeyId !== "string" ||
            typeof parsed.SecretAccessKey !== "string" ||
            typeof parsed.Token !== "string" ||
            typeof parsed.Expiration !== "string") {
            throw new property_provider_1.CredentialsProviderError("HTTP credential provider response not of the required format, an object matching: " +
                "{ AccessKeyId: string, SecretAccessKey: string, Token: string, Expiration: string(rfc3339) }", { logger });
        }
        return {
            accessKeyId: parsed.AccessKeyId,
            secretAccessKey: parsed.SecretAccessKey,
            sessionToken: parsed.Token,
            expiration: (0, smithy_client_1.parseRfc3339DateTime)(parsed.Expiration),
        };
    }
    if (response.statusCode >= 400 && response.statusCode < 500) {
        let parsedBody = {};
        try {
            parsedBody = JSON.parse(str);
        }
        catch (e) { }
        throw Object.assign(new property_provider_1.CredentialsProviderError(`Server responded with status: ${response.statusCode}`, { logger }), {
            Code: parsedBody.Code,
            Message: parsedBody.Message,
        });
    }
    throw new property_provider_1.CredentialsProviderError(`Server responded with status: ${response.statusCode}`, { logger });
}


/***/ }),

/***/ 9059:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.retryWrapper = void 0;
const retryWrapper = (toRetry, maxRetries, delayMs) => {
    return async () => {
        for (let i = 0; i < maxRetries; ++i) {
            try {
                return await toRetry();
            }
            catch (e) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        return await toRetry();
    };
};
exports.retryWrapper = retryWrapper;


/***/ }),

/***/ 19898:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromHttp = void 0;
var fromHttp_1 = __webpack_require__(30439);
Object.defineProperty(exports, "fromHttp", ({ enumerable: true, get: function () { return fromHttp_1.fromHttp; } }));


/***/ }),

/***/ 11646:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var sharedIniFileLoader = __webpack_require__(55358);
var propertyProvider = __webpack_require__(73798);
var node_child_process = __webpack_require__(31421);
var node_util = __webpack_require__(57975);
var client = __webpack_require__(54997);

const getValidatedProcessCredentials = (profileName, data, profiles) => {
    if (data.Version !== 1) {
        throw Error(`Profile ${profileName} credential_process did not return Version 1.`);
    }
    if (data.AccessKeyId === undefined || data.SecretAccessKey === undefined) {
        throw Error(`Profile ${profileName} credential_process returned invalid credentials.`);
    }
    if (data.Expiration) {
        const currentTime = new Date();
        const expireTime = new Date(data.Expiration);
        if (expireTime < currentTime) {
            throw Error(`Profile ${profileName} credential_process returned expired credentials.`);
        }
    }
    let accountId = data.AccountId;
    if (!accountId && profiles?.[profileName]?.aws_account_id) {
        accountId = profiles[profileName].aws_account_id;
    }
    const credentials = {
        accessKeyId: data.AccessKeyId,
        secretAccessKey: data.SecretAccessKey,
        ...(data.SessionToken && { sessionToken: data.SessionToken }),
        ...(data.Expiration && { expiration: new Date(data.Expiration) }),
        ...(data.CredentialScope && { credentialScope: data.CredentialScope }),
        ...(accountId && { accountId }),
    };
    client.setCredentialFeature(credentials, "CREDENTIALS_PROCESS", "w");
    return credentials;
};

const resolveProcessCredentials = async (profileName, profiles, logger) => {
    const profile = profiles[profileName];
    if (profiles[profileName]) {
        const credentialProcess = profile["credential_process"];
        if (credentialProcess !== undefined) {
            const execPromise = node_util.promisify(sharedIniFileLoader.externalDataInterceptor?.getTokenRecord?.().exec ?? node_child_process.exec);
            try {
                const { stdout } = await execPromise(credentialProcess);
                let data;
                try {
                    data = JSON.parse(stdout.trim());
                }
                catch {
                    throw Error(`Profile ${profileName} credential_process returned invalid JSON.`);
                }
                return getValidatedProcessCredentials(profileName, data, profiles);
            }
            catch (error) {
                throw new propertyProvider.CredentialsProviderError(error.message, { logger });
            }
        }
        else {
            throw new propertyProvider.CredentialsProviderError(`Profile ${profileName} did not contain credential_process.`, { logger });
        }
    }
    else {
        throw new propertyProvider.CredentialsProviderError(`Profile ${profileName} could not be found in shared credentials file.`, {
            logger,
        });
    }
};

const fromProcess = (init = {}) => async ({ callerClientConfig } = {}) => {
    init.logger?.debug("@aws-sdk/credential-provider-process - fromProcess");
    const profiles = await sharedIniFileLoader.parseKnownFiles(init);
    return resolveProcessCredentials(sharedIniFileLoader.getProfileName({
        profile: init.profile ?? callerClientConfig?.profile,
    }), profiles, init.logger);
};

exports.fromProcess = fromProcess;


/***/ }),

/***/ 95851:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromTokenFile = void 0;
const client_1 = __webpack_require__(54997);
const property_provider_1 = __webpack_require__(73798);
const shared_ini_file_loader_1 = __webpack_require__(55358);
const node_fs_1 = __webpack_require__(73024);
const fromWebToken_1 = __webpack_require__(94593);
const ENV_TOKEN_FILE = "AWS_WEB_IDENTITY_TOKEN_FILE";
const ENV_ROLE_ARN = "AWS_ROLE_ARN";
const ENV_ROLE_SESSION_NAME = "AWS_ROLE_SESSION_NAME";
const fromTokenFile = (init = {}) => async (awsIdentityProperties) => {
    init.logger?.debug("@aws-sdk/credential-provider-web-identity - fromTokenFile");
    const webIdentityTokenFile = init?.webIdentityTokenFile ?? process.env[ENV_TOKEN_FILE];
    const roleArn = init?.roleArn ?? process.env[ENV_ROLE_ARN];
    const roleSessionName = init?.roleSessionName ?? process.env[ENV_ROLE_SESSION_NAME];
    if (!webIdentityTokenFile || !roleArn) {
        throw new property_provider_1.CredentialsProviderError("Web identity configuration not specified", {
            logger: init.logger,
        });
    }
    const credentials = await (0, fromWebToken_1.fromWebToken)({
        ...init,
        webIdentityToken: shared_ini_file_loader_1.externalDataInterceptor?.getTokenRecord?.()[webIdentityTokenFile] ??
            (0, node_fs_1.readFileSync)(webIdentityTokenFile, { encoding: "ascii" }),
        roleArn,
        roleSessionName,
    })(awsIdentityProperties);
    if (webIdentityTokenFile === process.env[ENV_TOKEN_FILE]) {
        (0, client_1.setCredentialFeature)(credentials, "CREDENTIALS_ENV_VARS_STS_WEB_ID_TOKEN", "h");
    }
    return credentials;
};
exports.fromTokenFile = fromTokenFile;


/***/ }),

/***/ 94593:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromWebToken = void 0;
const fromWebToken = (init) => async (awsIdentityProperties) => {
    init.logger?.debug("@aws-sdk/credential-provider-web-identity - fromWebToken");
    const { roleArn, roleSessionName, webIdentityToken, providerId, policyArns, policy, durationSeconds } = init;
    let { roleAssumerWithWebIdentity } = init;
    if (!roleAssumerWithWebIdentity) {
        const { getDefaultRoleAssumerWithWebIdentity } = await Promise.resolve().then(() => __importStar(__webpack_require__(36791)));
        roleAssumerWithWebIdentity = getDefaultRoleAssumerWithWebIdentity({
            ...init.clientConfig,
            credentialProviderLogger: init.logger,
            parentClientConfig: {
                ...awsIdentityProperties?.callerClientConfig,
                ...init.parentClientConfig,
            },
        }, init.clientPlugins);
    }
    return roleAssumerWithWebIdentity({
        RoleArn: roleArn,
        RoleSessionName: roleSessionName ?? `aws-sdk-js-session-${Date.now()}`,
        WebIdentityToken: webIdentityToken,
        ProviderId: providerId,
        PolicyArns: policyArns,
        Policy: policy,
        DurationSeconds: durationSeconds,
    });
};
exports.fromWebToken = fromWebToken;


/***/ }),

/***/ 54568:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var fromTokenFile = __webpack_require__(95851);
var fromWebToken = __webpack_require__(94593);



Object.prototype.hasOwnProperty.call(fromTokenFile, '__proto__') &&
	!Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
	Object.defineProperty(exports, '__proto__', {
		enumerable: true,
		value: fromTokenFile['__proto__']
	});

Object.keys(fromTokenFile).forEach(function (k) {
	if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = fromTokenFile[k];
});
Object.prototype.hasOwnProperty.call(fromWebToken, '__proto__') &&
	!Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
	Object.defineProperty(exports, '__proto__', {
		enumerable: true,
		value: fromWebToken['__proto__']
	});

Object.keys(fromWebToken).forEach(function (k) {
	if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = fromWebToken[k];
});


/***/ }),

/***/ 42415:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.propertyProviderChain = exports.createCredentialChain = void 0;
const property_provider_1 = __webpack_require__(73798);
const createCredentialChain = (...credentialProviders) => {
    let expireAfter = -1;
    const baseFunction = async (awsIdentityProperties) => {
        const credentials = await (0, exports.propertyProviderChain)(...credentialProviders)(awsIdentityProperties);
        if (!credentials.expiration && expireAfter !== -1) {
            credentials.expiration = new Date(Date.now() + expireAfter);
        }
        return credentials;
    };
    const withOptions = Object.assign(baseFunction, {
        expireAfter(milliseconds) {
            if (milliseconds < 5 * 60_000) {
                throw new Error("@aws-sdk/credential-providers - createCredentialChain(...).expireAfter(ms) may not be called with a duration lower than five minutes.");
            }
            expireAfter = milliseconds;
            return withOptions;
        },
    });
    return withOptions;
};
exports.createCredentialChain = createCredentialChain;
const propertyProviderChain = (...providers) => async (awsIdentityProperties) => {
    if (providers.length === 0) {
        throw new property_provider_1.ProviderError("No providers in chain", { tryNextLink: false });
    }
    let lastProviderError;
    for (const provider of providers) {
        try {
            return await provider(awsIdentityProperties);
        }
        catch (err) {
            lastProviderError = err;
            if (err?.tryNextLink) {
                continue;
            }
            throw err;
        }
    }
    throw lastProviderError;
};
exports.propertyProviderChain = propertyProviderChain;


/***/ }),

/***/ 9068:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromCognitoIdentity = void 0;
const credential_provider_cognito_identity_1 = __webpack_require__(88542);
const fromCognitoIdentity = (options) => (0, credential_provider_cognito_identity_1.fromCognitoIdentity)({
    ...options,
});
exports.fromCognitoIdentity = fromCognitoIdentity;


/***/ }),

/***/ 93966:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromCognitoIdentityPool = void 0;
const credential_provider_cognito_identity_1 = __webpack_require__(88542);
const fromCognitoIdentityPool = (options) => (0, credential_provider_cognito_identity_1.fromCognitoIdentityPool)({
    ...options,
});
exports.fromCognitoIdentityPool = fromCognitoIdentityPool;


/***/ }),

/***/ 58175:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromContainerMetadata = void 0;
const credential_provider_imds_1 = __webpack_require__(78404);
const fromContainerMetadata = (init) => {
    init?.logger?.debug("@smithy/credential-provider-imds", "fromContainerMetadata");
    return (0, credential_provider_imds_1.fromContainerMetadata)(init);
};
exports.fromContainerMetadata = fromContainerMetadata;


/***/ }),

/***/ 70090:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromEnv = void 0;
const credential_provider_env_1 = __webpack_require__(48390);
const fromEnv = (init) => (0, credential_provider_env_1.fromEnv)(init);
exports.fromEnv = fromEnv;


/***/ }),

/***/ 78487:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromIni = void 0;
const credential_provider_ini_1 = __webpack_require__(20848);
const fromIni = (init = {}) => (0, credential_provider_ini_1.fromIni)({
    ...init,
});
exports.fromIni = fromIni;


/***/ }),

/***/ 18267:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromInstanceMetadata = void 0;
const client_1 = __webpack_require__(54997);
const credential_provider_imds_1 = __webpack_require__(78404);
const fromInstanceMetadata = (init) => {
    init?.logger?.debug("@smithy/credential-provider-imds", "fromInstanceMetadata");
    return async () => (0, credential_provider_imds_1.fromInstanceMetadata)(init)().then((creds) => (0, client_1.setCredentialFeature)(creds, "CREDENTIALS_IMDS", "0"));
};
exports.fromInstanceMetadata = fromInstanceMetadata;


/***/ }),

/***/ 20408:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromLoginCredentials = void 0;
const credential_provider_login_1 = __webpack_require__(45258);
const fromLoginCredentials = (init) => (0, credential_provider_login_1.fromLoginCredentials)({
    ...init,
});
exports.fromLoginCredentials = fromLoginCredentials;


/***/ }),

/***/ 12467:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromNodeProviderChain = void 0;
const credential_provider_node_1 = __webpack_require__(64605);
const fromNodeProviderChain = (init = {}) => (0, credential_provider_node_1.defaultProvider)({
    ...init,
});
exports.fromNodeProviderChain = fromNodeProviderChain;


/***/ }),

/***/ 112:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromProcess = void 0;
const credential_provider_process_1 = __webpack_require__(11646);
const fromProcess = (init) => (0, credential_provider_process_1.fromProcess)(init);
exports.fromProcess = fromProcess;


/***/ }),

/***/ 27410:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromSSO = void 0;
const credential_provider_sso_1 = __webpack_require__(87750);
const fromSSO = (init = {}) => {
    return (0, credential_provider_sso_1.fromSSO)({ ...init });
};
exports.fromSSO = fromSSO;


/***/ }),

/***/ 26815:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromTemporaryCredentials = void 0;
const core_1 = __webpack_require__(45135);
const property_provider_1 = __webpack_require__(73798);
const ASSUME_ROLE_DEFAULT_REGION = "us-east-1";
const fromTemporaryCredentials = (options, credentialDefaultProvider, regionProvider) => {
    let stsClient;
    return async (awsIdentityProperties = {}) => {
        const { callerClientConfig } = awsIdentityProperties;
        const profile = options.clientConfig?.profile ?? callerClientConfig?.profile;
        const logger = options.logger ?? callerClientConfig?.logger;
        logger?.debug("@aws-sdk/credential-providers - fromTemporaryCredentials (STS)");
        const params = { ...options.params, RoleSessionName: options.params.RoleSessionName ?? "aws-sdk-js-" + Date.now() };
        if (params?.SerialNumber) {
            if (!options.mfaCodeProvider) {
                throw new property_provider_1.CredentialsProviderError(`Temporary credential requires multi-factor authentication, but no MFA code callback was provided.`, {
                    tryNextLink: false,
                    logger,
                });
            }
            params.TokenCode = await options.mfaCodeProvider(params?.SerialNumber);
        }
        const { AssumeRoleCommand, STSClient } = await Promise.resolve().then(() => __importStar(__webpack_require__(36309)));
        if (!stsClient) {
            const defaultCredentialsOrError = typeof credentialDefaultProvider === "function" ? credentialDefaultProvider() : undefined;
            const credentialSources = [
                options.masterCredentials,
                options.clientConfig?.credentials,
                void callerClientConfig?.credentials,
                callerClientConfig?.credentialDefaultProvider?.(),
                defaultCredentialsOrError,
            ];
            let credentialSource = "STS client default credentials";
            if (credentialSources[0]) {
                credentialSource = "options.masterCredentials";
            }
            else if (credentialSources[1]) {
                credentialSource = "options.clientConfig.credentials";
            }
            else if (credentialSources[2]) {
                credentialSource = "caller client's credentials";
                throw new Error("fromTemporaryCredentials recursion in callerClientConfig.credentials");
            }
            else if (credentialSources[3]) {
                credentialSource = "caller client's credentialDefaultProvider";
            }
            else if (credentialSources[4]) {
                credentialSource = "AWS SDK default credentials";
            }
            const regionSources = [
                options.clientConfig?.region,
                callerClientConfig?.region,
                await regionProvider?.({
                    profile,
                }),
                ASSUME_ROLE_DEFAULT_REGION,
            ];
            let regionSource = "default partition's default region";
            if (regionSources[0]) {
                regionSource = "options.clientConfig.region";
            }
            else if (regionSources[1]) {
                regionSource = "caller client's region";
            }
            else if (regionSources[2]) {
                regionSource = "file or env region";
            }
            const requestHandlerSources = [
                filterRequestHandler(options.clientConfig?.requestHandler),
                filterRequestHandler(callerClientConfig?.requestHandler),
            ];
            let requestHandlerSource = "STS default requestHandler";
            if (requestHandlerSources[0]) {
                requestHandlerSource = "options.clientConfig.requestHandler";
            }
            else if (requestHandlerSources[1]) {
                requestHandlerSource = "caller client's requestHandler";
            }
            logger?.debug?.(`@aws-sdk/credential-providers - fromTemporaryCredentials STS client init with ` +
                `${regionSource}=${await (0, core_1.normalizeProvider)(coalesce(regionSources))()}, ${credentialSource}, ${requestHandlerSource}.`);
            stsClient = new STSClient({
                userAgentAppId: callerClientConfig?.userAgentAppId,
                ...options.clientConfig,
                credentials: coalesce(credentialSources),
                logger,
                profile,
                region: coalesce(regionSources),
                requestHandler: coalesce(requestHandlerSources),
            });
        }
        if (options.clientPlugins) {
            for (const plugin of options.clientPlugins) {
                stsClient.middlewareStack.use(plugin);
            }
        }
        const { Credentials } = await stsClient.send(new AssumeRoleCommand(params));
        if (!Credentials || !Credentials.AccessKeyId || !Credentials.SecretAccessKey) {
            throw new property_provider_1.CredentialsProviderError(`Invalid response from STS.assumeRole call with role ${params.RoleArn}`, {
                logger,
            });
        }
        return {
            accessKeyId: Credentials.AccessKeyId,
            secretAccessKey: Credentials.SecretAccessKey,
            sessionToken: Credentials.SessionToken,
            expiration: Credentials.Expiration,
            credentialScope: Credentials.CredentialScope,
        };
    };
};
exports.fromTemporaryCredentials = fromTemporaryCredentials;
const filterRequestHandler = (requestHandler) => {
    return requestHandler?.metadata?.handlerProtocol === "h2" ? undefined : requestHandler;
};
const coalesce = (args) => {
    for (const item of args) {
        if (item !== undefined) {
            return item;
        }
    }
};


/***/ }),

/***/ 45090:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromTemporaryCredentials = void 0;
const config_resolver_1 = __webpack_require__(9693);
const node_config_provider_1 = __webpack_require__(23575);
const fromNodeProviderChain_1 = __webpack_require__(12467);
const fromTemporaryCredentials_base_1 = __webpack_require__(26815);
const fromTemporaryCredentials = (options) => {
    return (0, fromTemporaryCredentials_base_1.fromTemporaryCredentials)(options, fromNodeProviderChain_1.fromNodeProviderChain, async ({ profile = process.env.AWS_PROFILE }) => (0, node_config_provider_1.loadConfig)({
        environmentVariableSelector: (env) => env.AWS_REGION,
        configFileSelector: (profileData) => {
            return profileData.region;
        },
        default: () => undefined,
    }, { ...config_resolver_1.NODE_REGION_CONFIG_FILE_OPTIONS, profile })());
};
exports.fromTemporaryCredentials = fromTemporaryCredentials;


/***/ }),

/***/ 4582:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromTokenFile = void 0;
const credential_provider_web_identity_1 = __webpack_require__(54568);
const fromTokenFile = (init = {}) => (0, credential_provider_web_identity_1.fromTokenFile)({
    ...init,
});
exports.fromTokenFile = fromTokenFile;


/***/ }),

/***/ 45246:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromWebToken = void 0;
const credential_provider_web_identity_1 = __webpack_require__(54568);
const fromWebToken = (init) => (0, credential_provider_web_identity_1.fromWebToken)({
    ...init,
});
exports.fromWebToken = fromWebToken;


/***/ }),

/***/ 12721:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fromHttp = void 0;
const tslib_1 = __webpack_require__(21440);
tslib_1.__exportStar(__webpack_require__(42415), exports);
tslib_1.__exportStar(__webpack_require__(9068), exports);
tslib_1.__exportStar(__webpack_require__(93966), exports);
tslib_1.__exportStar(__webpack_require__(58175), exports);
tslib_1.__exportStar(__webpack_require__(70090), exports);
var credential_provider_http_1 = __webpack_require__(19898);
Object.defineProperty(exports, "fromHttp", ({ enumerable: true, get: function () { return credential_provider_http_1.fromHttp; } }));
tslib_1.__exportStar(__webpack_require__(78487), exports);
tslib_1.__exportStar(__webpack_require__(18267), exports);
tslib_1.__exportStar(__webpack_require__(20408), exports);
tslib_1.__exportStar(__webpack_require__(12467), exports);
tslib_1.__exportStar(__webpack_require__(112), exports);
tslib_1.__exportStar(__webpack_require__(27410), exports);
tslib_1.__exportStar(__webpack_require__(45090), exports);
tslib_1.__exportStar(__webpack_require__(4582), exports);
tslib_1.__exportStar(__webpack_require__(45246), exports);


/***/ }),

/***/ 36309:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.STSClient = exports.AssumeRoleCommand = void 0;
const sts_1 = __webpack_require__(36791);
Object.defineProperty(exports, "AssumeRoleCommand", ({ enumerable: true, get: function () { return sts_1.AssumeRoleCommand; } }));
Object.defineProperty(exports, "STSClient", ({ enumerable: true, get: function () { return sts_1.STSClient; } }));


/***/ }),

/***/ 39586:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.resolveHttpAuthSchemeConfig = exports.defaultCognitoIdentityHttpAuthSchemeProvider = exports.defaultCognitoIdentityHttpAuthSchemeParametersProvider = void 0;
const httpAuthSchemes_1 = __webpack_require__(53880);
const util_middleware_1 = __webpack_require__(32362);
const defaultCognitoIdentityHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: (0, util_middleware_1.getSmithyContext)(context).operation,
        region: (await (0, util_middleware_1.normalizeProvider)(config.region)()) ||
            (() => {
                throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
            })(),
    };
};
exports.defaultCognitoIdentityHttpAuthSchemeParametersProvider = defaultCognitoIdentityHttpAuthSchemeParametersProvider;
function createAwsAuthSigv4HttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4",
        signingProperties: {
            name: "cognito-identity",
            region: authParameters.region,
        },
        propertiesExtractor: (config, context) => ({
            signingProperties: {
                config,
                context,
            },
        }),
    };
}
function createSmithyApiNoAuthHttpAuthOption(authParameters) {
    return {
        schemeId: "smithy.api#noAuth",
    };
}
const defaultCognitoIdentityHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        case "GetCredentialsForIdentity": {
            options.push(createSmithyApiNoAuthHttpAuthOption(authParameters));
            break;
        }
        case "GetId": {
            options.push(createSmithyApiNoAuthHttpAuthOption(authParameters));
            break;
        }
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
        }
    }
    return options;
};
exports.defaultCognitoIdentityHttpAuthSchemeProvider = defaultCognitoIdentityHttpAuthSchemeProvider;
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = (0, httpAuthSchemes_1.resolveAwsSdkSigV4Config)(config);
    return Object.assign(config_0, {
        authSchemePreference: (0, util_middleware_1.normalizeProvider)(config.authSchemePreference ?? []),
    });
};
exports.resolveHttpAuthSchemeConfig = resolveHttpAuthSchemeConfig;


/***/ }),

/***/ 22809:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.bdd = void 0;
const util_endpoints_1 = __webpack_require__(21474);
const m = "ref";
const a = -1, b = true, c = "isSet", d = "PartitionResult", e = "booleanEquals", f = "getAttr", g = "stringEquals", h = { [m]: "Endpoint" }, i = { [m]: d }, j = { [m]: "Region" }, k = {}, l = [j];
const _data = {
    conditions: [
        [c, [h]],
        [c, l],
        ["aws.partition", l, d],
        [e, [{ [m]: "UseFIPS" }, b]],
        [e, [{ fn: f, argv: [i, "supportsFIPS"] }, b]],
        [e, [{ [m]: "UseDualStack" }, b]],
        [e, [{ fn: f, argv: [i, "supportsDualStack"] }, b]],
        [g, [{ fn: f, argv: [i, "name"] }, "aws"]],
        [g, [j, "us-east-1"]],
        [g, [j, "us-east-2"]],
        [g, [j, "us-west-1"]],
        [g, [j, "us-west-2"]],
    ],
    results: [
        [a],
        [a, "Invalid Configuration: FIPS and custom endpoint are not supported"],
        [a, "Invalid Configuration: Dualstack and custom endpoint are not supported"],
        [h, k],
        ["https://cognito-identity-fips.us-east-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-east-2.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-2.amazonaws.com", k],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "FIPS and DualStack are enabled, but this partition does not support one or both"],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "FIPS is enabled but this partition does not support FIPS"],
        ["https://cognito-identity.{Region}.amazonaws.com", k],
        ["https://cognito-identity.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "DualStack is enabled but this partition does not support DualStack"],
        ["https://cognito-identity.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "Invalid Configuration: Missing Region"],
    ],
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1,
    1,
    -1,
    0,
    17,
    3,
    1,
    4,
    r + 16,
    2,
    5,
    r + 16,
    3,
    9,
    6,
    5,
    7,
    r + 15,
    6,
    8,
    r + 14,
    7,
    r + 12,
    r + 13,
    4,
    11,
    10,
    5,
    r + 9,
    r + 11,
    5,
    12,
    r + 10,
    6,
    13,
    r + 9,
    8,
    r + 4,
    14,
    9,
    r + 5,
    15,
    10,
    r + 6,
    16,
    11,
    r + 7,
    r + 8,
    3,
    r + 1,
    18,
    5,
    r + 2,
    r + 3,
]);
exports.bdd = util_endpoints_1.BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);


/***/ }),

/***/ 38876:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.defaultEndpointResolver = void 0;
const util_endpoints_1 = __webpack_require__(55546);
const util_endpoints_2 = __webpack_require__(21474);
const bdd_1 = __webpack_require__(22809);
const cache = new util_endpoints_2.EndpointCache({
    size: 50,
    params: ["Endpoint", "Region", "UseDualStack", "UseFIPS"],
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => (0, util_endpoints_2.decideEndpoint)(bdd_1.bdd, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
exports.defaultEndpointResolver = defaultEndpointResolver;
util_endpoints_2.customEndpointFunctions.aws = util_endpoints_1.awsEndpointFunctions;


/***/ }),

/***/ 51865:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var middlewareHostHeader = __webpack_require__(31001);
var middlewareLogger = __webpack_require__(67165);
var middlewareRecursionDetection = __webpack_require__(44330);
var middlewareUserAgent = __webpack_require__(52648);
var configResolver = __webpack_require__(9693);
var core = __webpack_require__(45135);
var schema = __webpack_require__(96507);
var middlewareContentLength = __webpack_require__(42966);
var middlewareEndpoint = __webpack_require__(83732);
var middlewareRetry = __webpack_require__(92807);
var smithyClient = __webpack_require__(47040);
var httpAuthSchemeProvider = __webpack_require__(39586);
var runtimeConfig = __webpack_require__(64851);
var regionConfigResolver = __webpack_require__(13512);
var protocolHttp = __webpack_require__(38578);
var schemas_0 = __webpack_require__(73089);
var errors = __webpack_require__(80293);
var CognitoIdentityServiceException = __webpack_require__(47817);

const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        useDualstackEndpoint: options.useDualstackEndpoint ?? false,
        useFipsEndpoint: options.useFipsEndpoint ?? false,
        defaultSigningName: "cognito-identity",
    });
};
const commonParams = {
    UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
    Endpoint: { type: "builtInParams", name: "endpoint" },
    Region: { type: "builtInParams", name: "region" },
    UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

const getHttpAuthExtensionConfiguration = (runtimeConfig) => {
    const _httpAuthSchemes = runtimeConfig.httpAuthSchemes;
    let _httpAuthSchemeProvider = runtimeConfig.httpAuthSchemeProvider;
    let _credentials = runtimeConfig.credentials;
    return {
        setHttpAuthScheme(httpAuthScheme) {
            const index = _httpAuthSchemes.findIndex((scheme) => scheme.schemeId === httpAuthScheme.schemeId);
            if (index === -1) {
                _httpAuthSchemes.push(httpAuthScheme);
            }
            else {
                _httpAuthSchemes.splice(index, 1, httpAuthScheme);
            }
        },
        httpAuthSchemes() {
            return _httpAuthSchemes;
        },
        setHttpAuthSchemeProvider(httpAuthSchemeProvider) {
            _httpAuthSchemeProvider = httpAuthSchemeProvider;
        },
        httpAuthSchemeProvider() {
            return _httpAuthSchemeProvider;
        },
        setCredentials(credentials) {
            _credentials = credentials;
        },
        credentials() {
            return _credentials;
        },
    };
};
const resolveHttpAuthRuntimeConfig = (config) => {
    return {
        httpAuthSchemes: config.httpAuthSchemes(),
        httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
        credentials: config.credentials(),
    };
};

const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
    const extensionConfiguration = Object.assign(regionConfigResolver.getAwsRegionExtensionConfiguration(runtimeConfig), smithyClient.getDefaultExtensionConfiguration(runtimeConfig), protocolHttp.getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
    extensions.forEach((extension) => extension.configure(extensionConfiguration));
    return Object.assign(runtimeConfig, regionConfigResolver.resolveAwsRegionExtensionConfiguration(extensionConfiguration), smithyClient.resolveDefaultRuntimeConfig(extensionConfiguration), protocolHttp.resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};

class CognitoIdentityClient extends smithyClient.Client {
    config;
    constructor(...[configuration]) {
        const _config_0 = runtimeConfig.getRuntimeConfig(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = resolveClientEndpointParameters(_config_0);
        const _config_2 = middlewareUserAgent.resolveUserAgentConfig(_config_1);
        const _config_3 = middlewareRetry.resolveRetryConfig(_config_2);
        const _config_4 = configResolver.resolveRegionConfig(_config_3);
        const _config_5 = middlewareHostHeader.resolveHostHeaderConfig(_config_4);
        const _config_6 = middlewareEndpoint.resolveEndpointConfig(_config_5);
        const _config_7 = httpAuthSchemeProvider.resolveHttpAuthSchemeConfig(_config_6);
        const _config_8 = resolveRuntimeExtensions(_config_7, configuration?.extensions || []);
        this.config = _config_8;
        this.middlewareStack.use(schema.getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(middlewareUserAgent.getUserAgentPlugin(this.config));
        this.middlewareStack.use(middlewareRetry.getRetryPlugin(this.config));
        this.middlewareStack.use(middlewareContentLength.getContentLengthPlugin(this.config));
        this.middlewareStack.use(middlewareHostHeader.getHostHeaderPlugin(this.config));
        this.middlewareStack.use(middlewareLogger.getLoggerPlugin(this.config));
        this.middlewareStack.use(middlewareRecursionDetection.getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(core.getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: httpAuthSchemeProvider.defaultCognitoIdentityHttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new core.DefaultIdentityProviderConfig({
                "aws.auth#sigv4": config.credentials,
            }),
        }));
        this.middlewareStack.use(core.getHttpSigningPlugin(this.config));
    }
    destroy() {
        super.destroy();
    }
}

class GetCredentialsForIdentityCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AWSCognitoIdentityService", "GetCredentialsForIdentity", {})
    .n("CognitoIdentityClient", "GetCredentialsForIdentityCommand")
    .sc(schemas_0.GetCredentialsForIdentity$)
    .build() {
}

class GetIdCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AWSCognitoIdentityService", "GetId", {})
    .n("CognitoIdentityClient", "GetIdCommand")
    .sc(schemas_0.GetId$)
    .build() {
}

const commands = {
    GetCredentialsForIdentityCommand,
    GetIdCommand,
};
class CognitoIdentity extends CognitoIdentityClient {
}
smithyClient.createAggregatedClient(commands, CognitoIdentity);

exports.$Command = smithyClient.Command;
exports.__Client = smithyClient.Client;
exports.CognitoIdentityServiceException = CognitoIdentityServiceException.CognitoIdentityServiceException;
exports.CognitoIdentity = CognitoIdentity;
exports.CognitoIdentityClient = CognitoIdentityClient;
exports.GetCredentialsForIdentityCommand = GetCredentialsForIdentityCommand;
exports.GetIdCommand = GetIdCommand;
Object.prototype.hasOwnProperty.call(schemas_0, '__proto__') &&
    !Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
    Object.defineProperty(exports, '__proto__', {
        enumerable: true,
        value: schemas_0['__proto__']
    });

Object.keys(schemas_0).forEach(function (k) {
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = schemas_0[k];
});
Object.prototype.hasOwnProperty.call(errors, '__proto__') &&
    !Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
    Object.defineProperty(exports, '__proto__', {
        enumerable: true,
        value: errors['__proto__']
    });

Object.keys(errors).forEach(function (k) {
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = errors[k];
});


/***/ }),

/***/ 47817:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CognitoIdentityServiceException = exports.__ServiceException = void 0;
const smithy_client_1 = __webpack_require__(47040);
Object.defineProperty(exports, "__ServiceException", ({ enumerable: true, get: function () { return smithy_client_1.ServiceException; } }));
class CognitoIdentityServiceException extends smithy_client_1.ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, CognitoIdentityServiceException.prototype);
    }
}
exports.CognitoIdentityServiceException = CognitoIdentityServiceException;


/***/ }),

/***/ 80293:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LimitExceededException = exports.TooManyRequestsException = exports.ResourceNotFoundException = exports.ResourceConflictException = exports.NotAuthorizedException = exports.InvalidParameterException = exports.InvalidIdentityPoolConfigurationException = exports.InternalErrorException = exports.ExternalServiceException = void 0;
const CognitoIdentityServiceException_1 = __webpack_require__(47817);
class ExternalServiceException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "ExternalServiceException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ExternalServiceException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ExternalServiceException.prototype);
    }
}
exports.ExternalServiceException = ExternalServiceException;
class InternalErrorException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "InternalErrorException";
    $fault = "server";
    constructor(opts) {
        super({
            name: "InternalErrorException",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalErrorException.prototype);
    }
}
exports.InternalErrorException = InternalErrorException;
class InvalidIdentityPoolConfigurationException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "InvalidIdentityPoolConfigurationException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidIdentityPoolConfigurationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidIdentityPoolConfigurationException.prototype);
    }
}
exports.InvalidIdentityPoolConfigurationException = InvalidIdentityPoolConfigurationException;
class InvalidParameterException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "InvalidParameterException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidParameterException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidParameterException.prototype);
    }
}
exports.InvalidParameterException = InvalidParameterException;
class NotAuthorizedException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "NotAuthorizedException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NotAuthorizedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NotAuthorizedException.prototype);
    }
}
exports.NotAuthorizedException = NotAuthorizedException;
class ResourceConflictException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "ResourceConflictException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceConflictException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceConflictException.prototype);
    }
}
exports.ResourceConflictException = ResourceConflictException;
class ResourceNotFoundException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "ResourceNotFoundException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceNotFoundException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
    }
}
exports.ResourceNotFoundException = ResourceNotFoundException;
class TooManyRequestsException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "TooManyRequestsException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "TooManyRequestsException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, TooManyRequestsException.prototype);
    }
}
exports.TooManyRequestsException = TooManyRequestsException;
class LimitExceededException extends CognitoIdentityServiceException_1.CognitoIdentityServiceException {
    name = "LimitExceededException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "LimitExceededException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, LimitExceededException.prototype);
    }
}
exports.LimitExceededException = LimitExceededException;


/***/ }),

/***/ 64851:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const tslib_1 = __webpack_require__(21440);
const package_json_1 = tslib_1.__importDefault(__webpack_require__(46337));
const client_1 = __webpack_require__(54997);
const httpAuthSchemes_1 = __webpack_require__(53880);
const util_user_agent_node_1 = __webpack_require__(19140);
const config_resolver_1 = __webpack_require__(9693);
const hash_node_1 = __webpack_require__(50594);
const middleware_retry_1 = __webpack_require__(92807);
const node_config_provider_1 = __webpack_require__(23575);
const node_http_handler_1 = __webpack_require__(55604);
const smithy_client_1 = __webpack_require__(47040);
const util_body_length_node_1 = __webpack_require__(81964);
const util_defaults_mode_node_1 = __webpack_require__(81910);
const util_retry_1 = __webpack_require__(89880);
const runtimeConfig_shared_1 = __webpack_require__(82064);
const getRuntimeConfig = (config) => {
    (0, smithy_client_1.emitWarningIfUnsupportedVersion)(process.version);
    const defaultsMode = (0, util_defaults_mode_node_1.resolveDefaultsModeConfig)(config);
    const defaultConfigProvider = () => defaultsMode().then(smithy_client_1.loadConfigsForDefaultMode);
    const clientSharedValues = (0, runtimeConfig_shared_1.getRuntimeConfig)(config);
    (0, client_1.emitWarningIfUnsupportedVersion)(process.version);
    const loaderConfig = {
        profile: config?.profile,
        logger: clientSharedValues.logger,
    };
    return {
        ...clientSharedValues,
        ...config,
        runtime: "node",
        defaultsMode,
        authSchemePreference: config?.authSchemePreference ?? (0, node_config_provider_1.loadConfig)(httpAuthSchemes_1.NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, loaderConfig),
        bodyLengthChecker: config?.bodyLengthChecker ?? util_body_length_node_1.calculateBodyLength,
        defaultUserAgentProvider: config?.defaultUserAgentProvider ??
            (0, util_user_agent_node_1.createDefaultUserAgentProvider)({ serviceId: clientSharedValues.serviceId, clientVersion: package_json_1.default.version }),
        maxAttempts: config?.maxAttempts ?? (0, node_config_provider_1.loadConfig)(middleware_retry_1.NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
        region: config?.region ??
            (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_REGION_CONFIG_OPTIONS, { ...config_resolver_1.NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
        requestHandler: node_http_handler_1.NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
        retryMode: config?.retryMode ??
            (0, node_config_provider_1.loadConfig)({
                ...middleware_retry_1.NODE_RETRY_MODE_CONFIG_OPTIONS,
                default: async () => (await defaultConfigProvider()).retryMode || util_retry_1.DEFAULT_RETRY_MODE,
            }, config),
        sha256: config?.sha256 ?? hash_node_1.Hash.bind(null, "sha256"),
        streamCollector: config?.streamCollector ?? node_http_handler_1.streamCollector,
        useDualstackEndpoint: config?.useDualstackEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        useFipsEndpoint: config?.useFipsEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        userAgentAppId: config?.userAgentAppId ?? (0, node_config_provider_1.loadConfig)(util_user_agent_node_1.NODE_APP_ID_CONFIG_OPTIONS, loaderConfig),
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 82064:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const httpAuthSchemes_1 = __webpack_require__(53880);
const protocols_1 = __webpack_require__(58795);
const core_1 = __webpack_require__(45135);
const smithy_client_1 = __webpack_require__(47040);
const url_parser_1 = __webpack_require__(42144);
const util_base64_1 = __webpack_require__(26290);
const util_utf8_1 = __webpack_require__(7697);
const httpAuthSchemeProvider_1 = __webpack_require__(39586);
const endpointResolver_1 = __webpack_require__(38876);
const schemas_0_1 = __webpack_require__(73089);
const getRuntimeConfig = (config) => {
    return {
        apiVersion: "2014-06-30",
        base64Decoder: config?.base64Decoder ?? util_base64_1.fromBase64,
        base64Encoder: config?.base64Encoder ?? util_base64_1.toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? endpointResolver_1.defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? httpAuthSchemeProvider_1.defaultCognitoIdentityHttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new httpAuthSchemes_1.AwsSdkSigV4Signer(),
            },
            {
                schemeId: "smithy.api#noAuth",
                identityProvider: (ipc) => ipc.getIdentityProvider("smithy.api#noAuth") || (async () => ({})),
                signer: new core_1.NoAuthSigner(),
            },
        ],
        logger: config?.logger ?? new smithy_client_1.NoOpLogger(),
        protocol: config?.protocol ?? protocols_1.AwsJson1_1Protocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.cognitoidentity",
            errorTypeRegistries: schemas_0_1.errorTypeRegistries,
            xmlNamespace: "http://cognito-identity.amazonaws.com/doc/2014-06-30/",
            version: "2014-06-30",
            serviceTarget: "AWSCognitoIdentityService",
        },
        serviceId: config?.serviceId ?? "Cognito Identity",
        urlParser: config?.urlParser ?? url_parser_1.parseUrl,
        utf8Decoder: config?.utf8Decoder ?? util_utf8_1.fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? util_utf8_1.toUtf8,
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 73089:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GetId$ = exports.GetCredentialsForIdentity$ = exports.GetIdResponse$ = exports.GetIdInput$ = exports.GetCredentialsForIdentityResponse$ = exports.GetCredentialsForIdentityInput$ = exports.Credentials$ = exports.errorTypeRegistries = exports.TooManyRequestsException$ = exports.ResourceNotFoundException$ = exports.ResourceConflictException$ = exports.NotAuthorizedException$ = exports.LimitExceededException$ = exports.InvalidParameterException$ = exports.InvalidIdentityPoolConfigurationException$ = exports.InternalErrorException$ = exports.ExternalServiceException$ = exports.CognitoIdentityServiceException$ = void 0;
const _AI = "AccountId";
const _AKI = "AccessKeyId";
const _C = "Credentials";
const _CRA = "CustomRoleArn";
const _E = "Expiration";
const _ESE = "ExternalServiceException";
const _GCFI = "GetCredentialsForIdentity";
const _GCFII = "GetCredentialsForIdentityInput";
const _GCFIR = "GetCredentialsForIdentityResponse";
const _GI = "GetId";
const _GII = "GetIdInput";
const _GIR = "GetIdResponse";
const _IEE = "InternalErrorException";
const _II = "IdentityId";
const _IIPCE = "InvalidIdentityPoolConfigurationException";
const _IPE = "InvalidParameterException";
const _IPI = "IdentityPoolId";
const _IPT = "IdentityProviderToken";
const _L = "Logins";
const _LEE = "LimitExceededException";
const _LM = "LoginsMap";
const _NAE = "NotAuthorizedException";
const _RCE = "ResourceConflictException";
const _RNFE = "ResourceNotFoundException";
const _SK = "SecretKey";
const _SKS = "SecretKeyString";
const _ST = "SessionToken";
const _TMRE = "TooManyRequestsException";
const _c = "client";
const _e = "error";
const _hE = "httpError";
const _m = "message";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.cognitoidentity";
const _se = "server";
const n0 = "com.amazonaws.cognitoidentity";
const schema_1 = __webpack_require__(96507);
const CognitoIdentityServiceException_1 = __webpack_require__(47817);
const errors_1 = __webpack_require__(80293);
const _s_registry = schema_1.TypeRegistry.for(_s);
exports.CognitoIdentityServiceException$ = [-3, _s, "CognitoIdentityServiceException", 0, [], []];
_s_registry.registerError(exports.CognitoIdentityServiceException$, CognitoIdentityServiceException_1.CognitoIdentityServiceException);
const n0_registry = schema_1.TypeRegistry.for(n0);
exports.ExternalServiceException$ = [-3, n0, _ESE, { [_e]: _c, [_hE]: 400 }, [_m], [0]];
n0_registry.registerError(exports.ExternalServiceException$, errors_1.ExternalServiceException);
exports.InternalErrorException$ = [-3, n0, _IEE, { [_e]: _se }, [_m], [0]];
n0_registry.registerError(exports.InternalErrorException$, errors_1.InternalErrorException);
exports.InvalidIdentityPoolConfigurationException$ = [
    -3,
    n0,
    _IIPCE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0],
];
n0_registry.registerError(exports.InvalidIdentityPoolConfigurationException$, errors_1.InvalidIdentityPoolConfigurationException);
exports.InvalidParameterException$ = [-3, n0, _IPE, { [_e]: _c, [_hE]: 400 }, [_m], [0]];
n0_registry.registerError(exports.InvalidParameterException$, errors_1.InvalidParameterException);
exports.LimitExceededException$ = [-3, n0, _LEE, { [_e]: _c, [_hE]: 400 }, [_m], [0]];
n0_registry.registerError(exports.LimitExceededException$, errors_1.LimitExceededException);
exports.NotAuthorizedException$ = [-3, n0, _NAE, { [_e]: _c, [_hE]: 403 }, [_m], [0]];
n0_registry.registerError(exports.NotAuthorizedException$, errors_1.NotAuthorizedException);
exports.ResourceConflictException$ = [-3, n0, _RCE, { [_e]: _c, [_hE]: 409 }, [_m], [0]];
n0_registry.registerError(exports.ResourceConflictException$, errors_1.ResourceConflictException);
exports.ResourceNotFoundException$ = [-3, n0, _RNFE, { [_e]: _c, [_hE]: 404 }, [_m], [0]];
n0_registry.registerError(exports.ResourceNotFoundException$, errors_1.ResourceNotFoundException);
exports.TooManyRequestsException$ = [-3, n0, _TMRE, { [_e]: _c, [_hE]: 429 }, [_m], [0]];
n0_registry.registerError(exports.TooManyRequestsException$, errors_1.TooManyRequestsException);
exports.errorTypeRegistries = [_s_registry, n0_registry];
var IdentityProviderToken = [0, n0, _IPT, 8, 0];
var SecretKeyString = [0, n0, _SKS, 8, 0];
exports.Credentials$ = [
    3,
    n0,
    _C,
    0,
    [_AKI, _SK, _ST, _E],
    [0, [() => SecretKeyString, 0], 0, 4],
];
exports.GetCredentialsForIdentityInput$ = [
    3,
    n0,
    _GCFII,
    0,
    [_II, _L, _CRA],
    [0, [() => LoginsMap, 0], 0],
    1,
];
exports.GetCredentialsForIdentityResponse$ = [
    3,
    n0,
    _GCFIR,
    0,
    [_II, _C],
    [0, [() => exports.Credentials$, 0]],
];
exports.GetIdInput$ = [3, n0, _GII, 0, [_IPI, _AI, _L], [0, 0, [() => LoginsMap, 0]], 1];
exports.GetIdResponse$ = [3, n0, _GIR, 0, [_II], [0]];
var LoginsMap = [2, n0, _LM, 0, [0, 0], [() => IdentityProviderToken, 0]];
exports.GetCredentialsForIdentity$ = [
    9,
    n0,
    _GCFI,
    0,
    () => exports.GetCredentialsForIdentityInput$,
    () => exports.GetCredentialsForIdentityResponse$,
];
exports.GetId$ = [9, n0, _GI, 0, () => exports.GetIdInput$, () => exports.GetIdResponse$];


/***/ }),

/***/ 78404:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var propertyProvider = __webpack_require__(73798);
var url = __webpack_require__(87016);
var buffer = __webpack_require__(20181);
var http = __webpack_require__(58611);
var nodeConfigProvider = __webpack_require__(23575);
var urlParser = __webpack_require__(42144);

function httpRequest(options) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            method: "GET",
            ...options,
            hostname: options.hostname?.replace(/^\[(.+)\]$/, "$1"),
        });
        req.on("error", (err) => {
            reject(Object.assign(new propertyProvider.ProviderError("Unable to connect to instance metadata service"), err));
            req.destroy();
        });
        req.on("timeout", () => {
            reject(new propertyProvider.ProviderError("TimeoutError from instance metadata service"));
            req.destroy();
        });
        req.on("response", (res) => {
            const { statusCode = 400 } = res;
            if (statusCode < 200 || 300 <= statusCode) {
                reject(Object.assign(new propertyProvider.ProviderError("Error response received from instance metadata service"), { statusCode }));
                req.destroy();
            }
            const chunks = [];
            res.on("data", (chunk) => {
                chunks.push(chunk);
            });
            res.on("end", () => {
                resolve(buffer.Buffer.concat(chunks));
                req.destroy();
            });
        });
        req.end();
    });
}

const isImdsCredentials = (arg) => Boolean(arg) &&
    typeof arg === "object" &&
    typeof arg.AccessKeyId === "string" &&
    typeof arg.SecretAccessKey === "string" &&
    typeof arg.Token === "string" &&
    typeof arg.Expiration === "string";
const fromImdsCredentials = (creds) => ({
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.Token,
    expiration: new Date(creds.Expiration),
    ...(creds.AccountId && { accountId: creds.AccountId }),
});

const DEFAULT_TIMEOUT = 1000;
const DEFAULT_MAX_RETRIES = 0;
const providerConfigFromInit = ({ maxRetries = DEFAULT_MAX_RETRIES, timeout = DEFAULT_TIMEOUT, }) => ({ maxRetries, timeout });

const retry = (toRetry, maxRetries) => {
    let promise = toRetry();
    for (let i = 0; i < maxRetries; i++) {
        promise = promise.catch(toRetry);
    }
    return promise;
};

const ENV_CMDS_FULL_URI = "AWS_CONTAINER_CREDENTIALS_FULL_URI";
const ENV_CMDS_RELATIVE_URI = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
const ENV_CMDS_AUTH_TOKEN = "AWS_CONTAINER_AUTHORIZATION_TOKEN";
const fromContainerMetadata = (init = {}) => {
    const { timeout, maxRetries } = providerConfigFromInit(init);
    return () => retry(async () => {
        const requestOptions = await getCmdsUri({ logger: init.logger });
        const credsResponse = JSON.parse(await requestFromEcsImds(timeout, requestOptions));
        if (!isImdsCredentials(credsResponse)) {
            throw new propertyProvider.CredentialsProviderError("Invalid response received from instance metadata service.", {
                logger: init.logger,
            });
        }
        return fromImdsCredentials(credsResponse);
    }, maxRetries);
};
const requestFromEcsImds = async (timeout, options) => {
    if (process.env[ENV_CMDS_AUTH_TOKEN]) {
        options.headers = {
            ...options.headers,
            Authorization: process.env[ENV_CMDS_AUTH_TOKEN],
        };
    }
    const buffer = await httpRequest({
        ...options,
        timeout,
    });
    return buffer.toString();
};
const CMDS_IP = "169.254.170.2";
const GREENGRASS_HOSTS = {
    localhost: true,
    "127.0.0.1": true,
};
const GREENGRASS_PROTOCOLS = {
    "http:": true,
    "https:": true,
};
const getCmdsUri = async ({ logger }) => {
    if (process.env[ENV_CMDS_RELATIVE_URI]) {
        return {
            hostname: CMDS_IP,
            path: process.env[ENV_CMDS_RELATIVE_URI],
        };
    }
    if (process.env[ENV_CMDS_FULL_URI]) {
        const parsed = url.parse(process.env[ENV_CMDS_FULL_URI]);
        if (!parsed.hostname || !(parsed.hostname in GREENGRASS_HOSTS)) {
            throw new propertyProvider.CredentialsProviderError(`${parsed.hostname} is not a valid container metadata service hostname`, {
                tryNextLink: false,
                logger,
            });
        }
        if (!parsed.protocol || !(parsed.protocol in GREENGRASS_PROTOCOLS)) {
            throw new propertyProvider.CredentialsProviderError(`${parsed.protocol} is not a valid container metadata service protocol`, {
                tryNextLink: false,
                logger,
            });
        }
        return {
            ...parsed,
            port: parsed.port ? parseInt(parsed.port, 10) : undefined,
        };
    }
    throw new propertyProvider.CredentialsProviderError("The container metadata credential provider cannot be used unless" +
        ` the ${ENV_CMDS_RELATIVE_URI} or ${ENV_CMDS_FULL_URI} environment` +
        " variable is set", {
        tryNextLink: false,
        logger,
    });
};

class InstanceMetadataV1FallbackError extends propertyProvider.CredentialsProviderError {
    tryNextLink;
    name = "InstanceMetadataV1FallbackError";
    constructor(message, tryNextLink = true) {
        super(message, tryNextLink);
        this.tryNextLink = tryNextLink;
        Object.setPrototypeOf(this, InstanceMetadataV1FallbackError.prototype);
    }
}

exports.Endpoint = void 0;
(function (Endpoint) {
    Endpoint["IPv4"] = "http://169.254.169.254";
    Endpoint["IPv6"] = "http://[fd00:ec2::254]";
})(exports.Endpoint || (exports.Endpoint = {}));

const ENV_ENDPOINT_NAME = "AWS_EC2_METADATA_SERVICE_ENDPOINT";
const CONFIG_ENDPOINT_NAME = "ec2_metadata_service_endpoint";
const ENDPOINT_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => env[ENV_ENDPOINT_NAME],
    configFileSelector: (profile) => profile[CONFIG_ENDPOINT_NAME],
    default: undefined,
};

var EndpointMode;
(function (EndpointMode) {
    EndpointMode["IPv4"] = "IPv4";
    EndpointMode["IPv6"] = "IPv6";
})(EndpointMode || (EndpointMode = {}));

const ENV_ENDPOINT_MODE_NAME = "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE";
const CONFIG_ENDPOINT_MODE_NAME = "ec2_metadata_service_endpoint_mode";
const ENDPOINT_MODE_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => env[ENV_ENDPOINT_MODE_NAME],
    configFileSelector: (profile) => profile[CONFIG_ENDPOINT_MODE_NAME],
    default: EndpointMode.IPv4,
};

const getInstanceMetadataEndpoint = async () => urlParser.parseUrl((await getFromEndpointConfig()) || (await getFromEndpointModeConfig()));
const getFromEndpointConfig = async () => nodeConfigProvider.loadConfig(ENDPOINT_CONFIG_OPTIONS)();
const getFromEndpointModeConfig = async () => {
    const endpointMode = await nodeConfigProvider.loadConfig(ENDPOINT_MODE_CONFIG_OPTIONS)();
    switch (endpointMode) {
        case EndpointMode.IPv4:
            return exports.Endpoint.IPv4;
        case EndpointMode.IPv6:
            return exports.Endpoint.IPv6;
        default:
            throw new Error(`Unsupported endpoint mode: ${endpointMode}.` + ` Select from ${Object.values(EndpointMode)}`);
    }
};

const STATIC_STABILITY_REFRESH_INTERVAL_SECONDS = 5 * 60;
const STATIC_STABILITY_REFRESH_INTERVAL_JITTER_WINDOW_SECONDS = 5 * 60;
const STATIC_STABILITY_DOC_URL = "https://docs.aws.amazon.com/sdkref/latest/guide/feature-static-credentials.html";
const getExtendedInstanceMetadataCredentials = (credentials, logger) => {
    const refreshInterval = STATIC_STABILITY_REFRESH_INTERVAL_SECONDS +
        Math.floor(Math.random() * STATIC_STABILITY_REFRESH_INTERVAL_JITTER_WINDOW_SECONDS);
    const newExpiration = new Date(Date.now() + refreshInterval * 1000);
    logger.warn("Attempting credential expiration extension due to a credential service availability issue. A refresh of these " +
        `credentials will be attempted after ${new Date(newExpiration)}.\nFor more information, please visit: ` +
        STATIC_STABILITY_DOC_URL);
    const originalExpiration = credentials.originalExpiration ?? credentials.expiration;
    return {
        ...credentials,
        ...(originalExpiration ? { originalExpiration } : {}),
        expiration: newExpiration,
    };
};

const staticStabilityProvider = (provider, options = {}) => {
    const logger = options?.logger || console;
    let pastCredentials;
    return async () => {
        let credentials;
        try {
            credentials = await provider();
            if (credentials.expiration && credentials.expiration.getTime() < Date.now()) {
                credentials = getExtendedInstanceMetadataCredentials(credentials, logger);
            }
        }
        catch (e) {
            if (pastCredentials) {
                logger.warn("Credential renew failed: ", e);
                credentials = getExtendedInstanceMetadataCredentials(pastCredentials, logger);
            }
            else {
                throw e;
            }
        }
        pastCredentials = credentials;
        return credentials;
    };
};

const IMDS_PATH = "/latest/meta-data/iam/security-credentials/";
const IMDS_TOKEN_PATH = "/latest/api/token";
const AWS_EC2_METADATA_V1_DISABLED = "AWS_EC2_METADATA_V1_DISABLED";
const PROFILE_AWS_EC2_METADATA_V1_DISABLED = "ec2_metadata_v1_disabled";
const X_AWS_EC2_METADATA_TOKEN = "x-aws-ec2-metadata-token";
const fromInstanceMetadata = (init = {}) => staticStabilityProvider(getInstanceMetadataProvider(init), { logger: init.logger });
const getInstanceMetadataProvider = (init = {}) => {
    let disableFetchToken = false;
    const { logger, profile } = init;
    const { timeout, maxRetries } = providerConfigFromInit(init);
    const getCredentials = async (maxRetries, options) => {
        const isImdsV1Fallback = disableFetchToken || options.headers?.[X_AWS_EC2_METADATA_TOKEN] == null;
        if (isImdsV1Fallback) {
            let fallbackBlockedFromProfile = false;
            let fallbackBlockedFromProcessEnv = false;
            const configValue = await nodeConfigProvider.loadConfig({
                environmentVariableSelector: (env) => {
                    const envValue = env[AWS_EC2_METADATA_V1_DISABLED];
                    fallbackBlockedFromProcessEnv = !!envValue && envValue !== "false";
                    if (envValue === undefined) {
                        throw new propertyProvider.CredentialsProviderError(`${AWS_EC2_METADATA_V1_DISABLED} not set in env, checking config file next.`, { logger: init.logger });
                    }
                    return fallbackBlockedFromProcessEnv;
                },
                configFileSelector: (profile) => {
                    const profileValue = profile[PROFILE_AWS_EC2_METADATA_V1_DISABLED];
                    fallbackBlockedFromProfile = !!profileValue && profileValue !== "false";
                    return fallbackBlockedFromProfile;
                },
                default: false,
            }, {
                profile,
            })();
            if (init.ec2MetadataV1Disabled || configValue) {
                const causes = [];
                if (init.ec2MetadataV1Disabled)
                    causes.push("credential provider initialization (runtime option ec2MetadataV1Disabled)");
                if (fallbackBlockedFromProfile)
                    causes.push(`config file profile (${PROFILE_AWS_EC2_METADATA_V1_DISABLED})`);
                if (fallbackBlockedFromProcessEnv)
                    causes.push(`process environment variable (${AWS_EC2_METADATA_V1_DISABLED})`);
                throw new InstanceMetadataV1FallbackError(`AWS EC2 Metadata v1 fallback has been blocked by AWS SDK configuration in the following: [${causes.join(", ")}].`);
            }
        }
        const imdsProfile = (await retry(async () => {
            let profile;
            try {
                profile = await getProfile(options);
            }
            catch (err) {
                if (err.statusCode === 401) {
                    disableFetchToken = false;
                }
                throw err;
            }
            return profile;
        }, maxRetries)).trim();
        return retry(async () => {
            let creds;
            try {
                creds = await getCredentialsFromProfile(imdsProfile, options, init);
            }
            catch (err) {
                if (err.statusCode === 401) {
                    disableFetchToken = false;
                }
                throw err;
            }
            return creds;
        }, maxRetries);
    };
    return async () => {
        const endpoint = await getInstanceMetadataEndpoint();
        if (disableFetchToken) {
            logger?.debug("AWS SDK Instance Metadata", "using v1 fallback (no token fetch)");
            return getCredentials(maxRetries, { ...endpoint, timeout });
        }
        else {
            let token;
            try {
                token = (await getMetadataToken({ ...endpoint, timeout })).toString();
            }
            catch (error) {
                if (error?.statusCode === 400) {
                    throw Object.assign(error, {
                        message: "EC2 Metadata token request returned error",
                    });
                }
                else if (error.message === "TimeoutError" || [403, 404, 405].includes(error.statusCode)) {
                    disableFetchToken = true;
                }
                logger?.debug("AWS SDK Instance Metadata", "using v1 fallback (initial)");
                return getCredentials(maxRetries, { ...endpoint, timeout });
            }
            return getCredentials(maxRetries, {
                ...endpoint,
                headers: {
                    [X_AWS_EC2_METADATA_TOKEN]: token,
                },
                timeout,
            });
        }
    };
};
const getMetadataToken = async (options) => httpRequest({
    ...options,
    path: IMDS_TOKEN_PATH,
    method: "PUT",
    headers: {
        "x-aws-ec2-metadata-token-ttl-seconds": "21600",
    },
});
const getProfile = async (options) => (await httpRequest({ ...options, path: IMDS_PATH })).toString();
const getCredentialsFromProfile = async (profile, options, init) => {
    const credentialsResponse = JSON.parse((await httpRequest({
        ...options,
        path: IMDS_PATH + profile,
    })).toString());
    if (!isImdsCredentials(credentialsResponse)) {
        throw new propertyProvider.CredentialsProviderError("Invalid response received from instance metadata service.", {
            logger: init.logger,
        });
    }
    return fromImdsCredentials(credentialsResponse);
};

exports.DEFAULT_MAX_RETRIES = DEFAULT_MAX_RETRIES;
exports.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;
exports.ENV_CMDS_AUTH_TOKEN = ENV_CMDS_AUTH_TOKEN;
exports.ENV_CMDS_FULL_URI = ENV_CMDS_FULL_URI;
exports.ENV_CMDS_RELATIVE_URI = ENV_CMDS_RELATIVE_URI;
exports.fromContainerMetadata = fromContainerMetadata;
exports.fromInstanceMetadata = fromInstanceMetadata;
exports.getInstanceMetadataEndpoint = getInstanceMetadataEndpoint;
exports.httpRequest = httpRequest;
exports.providerConfigFromInit = providerConfigFromInit;


/***/ })

};
