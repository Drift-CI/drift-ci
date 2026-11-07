export const id = 297;
export const ids = [297];
export const modules = {

/***/ 79436:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

const { CredentialsProviderError } = __webpack_require__(93141);

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
        const { GetCredentialsForIdentityCommand, CognitoIdentityClient } = __webpack_require__(56262);
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
    throw new CredentialsProviderError("Response from Amazon Cognito contained no access key ID", { logger });
}
function throwOnMissingCredentials(logger) {
    throw new CredentialsProviderError("Response from Amazon Cognito contained no credentials", { logger });
}
function throwOnMissingSecretKey(logger) {
    throw new CredentialsProviderError("Response from Amazon Cognito contained no secret key", { logger });
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
        const { GetIdCommand, CognitoIdentityClient } = __webpack_require__(56262);
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
    throw new CredentialsProviderError("Response from Amazon Cognito contained no identity ID", { logger });
}

exports.fromCognitoIdentity = fromCognitoIdentity;
exports.fromCognitoIdentityPool = fromCognitoIdentityPool;


/***/ }),

/***/ 56262:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

const { CognitoIdentityClient, GetCredentialsForIdentityCommand, GetIdCommand } = __webpack_require__(51533);
exports.CognitoIdentityClient = CognitoIdentityClient;
exports.GetCredentialsForIdentityCommand = GetCredentialsForIdentityCommand;
exports.GetIdCommand = GetIdCommand;


/***/ }),

/***/ 41297:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

const { ProviderError, CredentialsProviderError, loadConfig, NODE_REGION_CONFIG_FILE_OPTIONS } = __webpack_require__(93141);
const { normalizeProvider } = __webpack_require__(89696);

const createCredentialChain = (...credentialProviders) => {
    let expireAfter = -1;
    const baseFunction = async (awsIdentityProperties) => {
        const credentials = await propertyProviderChain(...credentialProviders)(awsIdentityProperties);
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
const propertyProviderChain = (...providers) => async (awsIdentityProperties) => {
    if (providers.length === 0) {
        throw new ProviderError("No providers in chain", { tryNextLink: false });
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

const fromCognitoIdentity = (options) => {
    return async (args) => {
        const { fromCognitoIdentity: _fromCognitoIdentity } = __webpack_require__(79436);
        return _fromCognitoIdentity(options)(args);
    };
};

const fromCognitoIdentityPool = (options) => {
    return async (args) => {
        const { fromCognitoIdentityPool: _fromCognitoIdentityPool } = __webpack_require__(79436);
        return _fromCognitoIdentityPool(options)(args);
    };
};

const fromContainerMetadata = (init) => {
    return async (props) => {
        init?.logger?.debug("@smithy/credential-provider-imds", "fromContainerMetadata");
        const { fromContainerMetadata: _fromContainerMetadata } = __webpack_require__(520);
        return _fromContainerMetadata(init)();
    };
};

const fromEnv = (init) => {
    return async (args) => {
        const { fromEnv: _fromEnv } = __webpack_require__(69786);
        return _fromEnv(init)(args);
    };
};

const fromHttp = (options = {}) => {
    return async (args) => {
        const { fromHttp: _fromHttp } = __webpack_require__(26250);
        return _fromHttp(options)(args);
    };
};

const fromIni = (init = {}) => {
    return async (args) => {
        const { fromIni: _fromIni } = __webpack_require__(74232);
        return _fromIni({ ...init })(args);
    };
};

const fromInstanceMetadata = (init) => {
    return async (props) => {
        init?.logger?.debug("@smithy/credential-provider-imds", "fromInstanceMetadata");
        const { setCredentialFeature } = __webpack_require__(87438);
        const { fromInstanceMetadata: _fromInstanceMetadata } = __webpack_require__(520);
        return _fromInstanceMetadata(init)().then((creds) => setCredentialFeature(creds, "CREDENTIALS_IMDS", "0"));
    };
};

const fromLoginCredentials = (init) => {
    return async (args) => {
        const { fromLoginCredentials: _fromLoginCredentials } = __webpack_require__(63045);
        return _fromLoginCredentials({ ...init })(args);
    };
};

const fromNodeProviderChain = (init = {}) => {
    let chain;
    return async (args) => {
        if (!chain) {
            const { defaultProvider } = __webpack_require__(15899);
            chain = defaultProvider({ ...init });
        }
        return chain(args);
    };
};

const fromProcess = (init) => {
    return async (args) => {
        const { fromProcess: _fromProcess } = __webpack_require__(51022);
        return _fromProcess(init)(args);
    };
};

const fromSSO = (init = {}) => {
    return async (args) => {
        const { fromSSO: _fromSSO } = __webpack_require__(22839);
        return _fromSSO({ ...init })(args);
    };
};

const ASSUME_ROLE_DEFAULT_REGION = "us-east-1";
const fromTemporaryCredentials$1 = (options, credentialDefaultProvider, regionProvider) => {
    let stsClient;
    return async (awsIdentityProperties = {}) => {
        const { callerClientConfig } = awsIdentityProperties;
        const profile = options.clientConfig?.profile ?? callerClientConfig?.profile;
        const logger = options.logger ?? callerClientConfig?.logger;
        logger?.debug("@aws-sdk/credential-providers - fromTemporaryCredentials (STS)");
        const params = { ...options.params, RoleSessionName: options.params.RoleSessionName ?? "aws-sdk-js-" + Date.now() };
        if (params?.SerialNumber) {
            if (!options.mfaCodeProvider) {
                throw new CredentialsProviderError(`Temporary credential requires multi-factor authentication, but no MFA code callback was provided.`, {
                    tryNextLink: false,
                    logger,
                });
            }
            params.TokenCode = await options.mfaCodeProvider(params?.SerialNumber);
        }
        const { AssumeRoleCommand, STSClient } = __webpack_require__(35328);
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
                `${regionSource}=${await normalizeProvider(coalesce(regionSources))()}, ${credentialSource}, ${requestHandlerSource}.`);
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
            throw new CredentialsProviderError(`Invalid response from STS.assumeRole call with role ${params.RoleArn}`, {
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

const fromTemporaryCredentials = (options) => {
    return fromTemporaryCredentials$1(options, fromNodeProviderChain, async ({ profile = process.env.AWS_PROFILE }) => loadConfig({
        environmentVariableSelector: (env) => env.AWS_REGION,
        configFileSelector: (profileData) => {
            return profileData.region;
        },
        default: () => undefined,
    }, { ...NODE_REGION_CONFIG_FILE_OPTIONS, profile })());
};

const fromTokenFile = (init = {}) => {
    return async (args) => {
        const { fromTokenFile: _fromTokenFile } = __webpack_require__(72570);
        return _fromTokenFile({ ...init })(args);
    };
};

const fromWebToken = (init) => {
    return async (args) => {
        const { fromWebToken: _fromWebToken } = __webpack_require__(72570);
        return _fromWebToken({ ...init })(args);
    };
};

exports.createCredentialChain = createCredentialChain;
exports.fromCognitoIdentity = fromCognitoIdentity;
exports.fromCognitoIdentityPool = fromCognitoIdentityPool;
exports.fromContainerMetadata = fromContainerMetadata;
exports.fromEnv = fromEnv;
exports.fromHttp = fromHttp;
exports.fromIni = fromIni;
exports.fromInstanceMetadata = fromInstanceMetadata;
exports.fromLoginCredentials = fromLoginCredentials;
exports.fromNodeProviderChain = fromNodeProviderChain;
exports.fromProcess = fromProcess;
exports.fromSSO = fromSSO;
exports.fromTemporaryCredentials = fromTemporaryCredentials;
exports.fromTokenFile = fromTokenFile;
exports.fromWebToken = fromWebToken;
exports.propertyProviderChain = propertyProviderChain;


/***/ }),

/***/ 35328:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

const { AssumeRoleCommand, STSClient } = __webpack_require__(81891);
exports.AssumeRoleCommand = AssumeRoleCommand;
exports.STSClient = STSClient;


/***/ }),

/***/ 51533:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

const { awsEndpointFunctions, emitWarningIfUnsupportedVersion: emitWarningIfUnsupportedVersion$1, createDefaultUserAgentProvider, NODE_APP_ID_CONFIG_OPTIONS, getAwsRegionExtensionConfiguration, resolveAwsRegionExtensionConfiguration, resolveUserAgentConfig, resolveHostHeaderConfig, getUserAgentPlugin, getHostHeaderPlugin, getLoggerPlugin, getRecursionDetectionPlugin } = __webpack_require__(87438);
const { NoAuthSigner, getHttpAuthSchemeEndpointRuleSetPlugin, DefaultIdentityProviderConfig, getHttpSigningPlugin } = __webpack_require__(89696);
const { normalizeProvider, getSmithyContext, ServiceException, NoOpLogger, emitWarningIfUnsupportedVersion, loadConfigsForDefaultMode, getDefaultExtensionConfiguration, resolveDefaultRuntimeConfig, Client, makeBuilder, createAggregatedClient } = __webpack_require__(97696);
const { Command: $Command } = __webpack_require__(97696);
exports.$Command = $Command;
exports.__Client = Client;
const { resolveDefaultsModeConfig, loadConfig, NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, NODE_REGION_CONFIG_OPTIONS, NODE_REGION_CONFIG_FILE_OPTIONS, resolveRegionConfig } = __webpack_require__(93141);
const { BinaryDecisionDiagram, EndpointCache, decideEndpoint, customEndpointFunctions, resolveEndpointConfig, getEndpointPlugin } = __webpack_require__(70799);
const { parseUrl, getHttpHandlerExtensionConfiguration, resolveHttpHandlerRuntimeConfig, getContentLengthPlugin } = __webpack_require__(28232);
const { DEFAULT_RETRY_MODE, NODE_RETRY_MODE_CONFIG_OPTIONS, NODE_MAX_ATTEMPT_CONFIG_OPTIONS, resolveRetryConfig, getRetryPlugin } = __webpack_require__(42483);
const { TypeRegistry, getSchemaSerdePlugin } = __webpack_require__(98784);
const { resolveAwsSdkSigV4Config, AwsSdkSigV4Signer, NODE_AUTH_SCHEME_PREFERENCE_OPTIONS } = __webpack_require__(43801);
const { toUtf8, fromUtf8, toBase64, fromBase64, calculateBodyLength } = __webpack_require__(99968);
const { streamCollector, NodeHttpHandler } = __webpack_require__(73747);
const { AwsJson1_1Protocol } = __webpack_require__(490);
const { Sha256 } = __webpack_require__(70412);

const defaultCognitoIdentityHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: getSmithyContext(context).operation,
        region: await normalizeProvider(config.region)() || (() => {
            throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
        })(),
    };
};
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
        case "GetCredentialsForIdentity":
            {
                options.push(createSmithyApiNoAuthHttpAuthOption());
                break;
            }
        case "GetId":
            {
                options.push(createSmithyApiNoAuthHttpAuthOption());
                break;
            }
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
        }
    }
    return options;
};
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = resolveAwsSdkSigV4Config(config);
    return Object.assign(config_0, {
        authSchemePreference: normalizeProvider(config.authSchemePreference ?? []),
    });
};

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

var version = "3.997.53";
var packageInfo = {
	version: version};

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
        [g, [j, "us-west-2"]]
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
        [a, "Invalid Configuration: Missing Region"]
    ]
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1, 1, -1,
    0, 17, 3,
    1, 4, r + 16,
    2, 5, r + 16,
    3, 9, 6,
    5, 7, r + 15,
    6, 8, r + 14,
    7, r + 12, r + 13,
    4, 11, 10,
    5, r + 9, r + 11,
    5, 12, r + 10,
    6, 13, r + 9,
    8, r + 4, 14,
    9, r + 5, 15,
    10, r + 6, 16,
    11, r + 7, r + 8,
    3, r + 1, 18,
    5, r + 2, r + 3,
]);
const bdd = BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);

const cache = new EndpointCache({
    size: 50,
    params: ["Endpoint", "Region", "UseDualStack", "UseFIPS"],
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => decideEndpoint(bdd, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
customEndpointFunctions.aws = awsEndpointFunctions;

class CognitoIdentityServiceException extends ServiceException {
    static shapeId = "smithy.ts.sdk.synthetic.com.amazonaws.cognitoidentity#CognitoIdentityServiceException";
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, CognitoIdentityServiceException.prototype);
    }
}

class ExternalServiceException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#ExternalServiceException";
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
class InternalErrorException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#InternalErrorException";
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
class InvalidIdentityPoolConfigurationException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#InvalidIdentityPoolConfigurationException";
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
class InvalidParameterException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#InvalidParameterException";
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
class NotAuthorizedException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#NotAuthorizedException";
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
class ResourceConflictException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#ResourceConflictException";
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
class ResourceNotFoundException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#ResourceNotFoundException";
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
class TooManyRequestsException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#TooManyRequestsException";
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
class LimitExceededException extends CognitoIdentityServiceException {
    static shapeId = "com.amazonaws.cognitoidentity#LimitExceededException";
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
const _s_registry = new TypeRegistry(_s);
var CognitoIdentityServiceException$ = [-3, _s, "CognitoIdentityServiceException", 0, [], []];
_s_registry.registerError(CognitoIdentityServiceException$, CognitoIdentityServiceException);
const n0_registry = new TypeRegistry(n0);
var ExternalServiceException$ = [-3, n0, _ESE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(ExternalServiceException$, ExternalServiceException);
var InternalErrorException$ = [-3, n0, _IEE,
    { [_e]: _se },
    [_m],
    [0]
];
n0_registry.registerError(InternalErrorException$, InternalErrorException);
var InvalidIdentityPoolConfigurationException$ = [-3, n0, _IIPCE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(InvalidIdentityPoolConfigurationException$, InvalidIdentityPoolConfigurationException);
var InvalidParameterException$ = [-3, n0, _IPE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(InvalidParameterException$, InvalidParameterException);
var LimitExceededException$ = [-3, n0, _LEE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(LimitExceededException$, LimitExceededException);
var NotAuthorizedException$ = [-3, n0, _NAE,
    { [_e]: _c, [_hE]: 403 },
    [_m],
    [0]
];
n0_registry.registerError(NotAuthorizedException$, NotAuthorizedException);
var ResourceConflictException$ = [-3, n0, _RCE,
    { [_e]: _c, [_hE]: 409 },
    [_m],
    [0]
];
n0_registry.registerError(ResourceConflictException$, ResourceConflictException);
var ResourceNotFoundException$ = [-3, n0, _RNFE,
    { [_e]: _c, [_hE]: 404 },
    [_m],
    [0]
];
n0_registry.registerError(ResourceNotFoundException$, ResourceNotFoundException);
var TooManyRequestsException$ = [-3, n0, _TMRE,
    { [_e]: _c, [_hE]: 429 },
    [_m],
    [0]
];
n0_registry.registerError(TooManyRequestsException$, TooManyRequestsException);
const errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
var IdentityProviderToken = [0, n0, _IPT, 8, 0];
var SecretKeyString = [0, n0, _SKS, 8, 0];
var Credentials$ = [3, n0, _C,
    0,
    [_AKI, _SK, _ST, _E],
    [0, [() => SecretKeyString, 0], 0, 4]
];
var GetCredentialsForIdentityInput$ = [3, n0, _GCFII,
    0,
    [_II, _L, _CRA],
    [0, [() => LoginsMap, 0], 0], 1
];
var GetCredentialsForIdentityResponse$ = [3, n0, _GCFIR,
    0,
    [_II, _C],
    [0, [() => Credentials$, 0]]
];
var GetIdInput$ = [3, n0, _GII,
    0,
    [_IPI, _AI, _L],
    [0, 0, [() => LoginsMap, 0]], 1
];
var GetIdResponse$ = [3, n0, _GIR,
    0,
    [_II],
    [0]
];
var LoginsMap = [2, n0, _LM,
    0, [0,
        0],
    [() => IdentityProviderToken,
        0]
];
var GetCredentialsForIdentity$ = [9, n0, _GCFI,
    0, () => GetCredentialsForIdentityInput$, () => GetCredentialsForIdentityResponse$
];
var GetId$ = [9, n0, _GI,
    0, () => GetIdInput$, () => GetIdResponse$
];

const getRuntimeConfig$1 = (config) => {
    return {
        apiVersion: "2014-06-30",
        base64Decoder: config?.base64Decoder ?? fromBase64,
        base64Encoder: config?.base64Encoder ?? toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? defaultCognitoIdentityHttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new AwsSdkSigV4Signer(),
            },
            {
                schemeId: "smithy.api#noAuth",
                identityProvider: (ipc) => ipc.getIdentityProvider("smithy.api#noAuth") || (async () => ({})),
                signer: new NoAuthSigner(),
            },
        ],
        logger: config?.logger ?? new NoOpLogger(),
        protocol: config?.protocol ?? AwsJson1_1Protocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.cognitoidentity",
            errorTypeRegistries,
            xmlNamespace: "http://cognito-identity.amazonaws.com/doc/2014-06-30/",
            version: "2014-06-30",
            serviceTarget: "AWSCognitoIdentityService",
        },
        serviceId: config?.serviceId ?? "Cognito Identity",
        sha256: config?.sha256 ?? Sha256,
        urlParser: config?.urlParser ?? parseUrl,
        utf8Decoder: config?.utf8Decoder ?? fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? toUtf8,
    };
};

const getRuntimeConfig = (config) => {
    emitWarningIfUnsupportedVersion(process.version);
    const defaultsMode = resolveDefaultsModeConfig(config);
    const defaultConfigProvider = () => defaultsMode().then(loadConfigsForDefaultMode);
    const clientSharedValues = getRuntimeConfig$1(config);
    emitWarningIfUnsupportedVersion$1(process.version);
    const loaderConfig = {
        profile: config?.profile,
        logger: clientSharedValues.logger,
    };
    return {
        ...clientSharedValues,
        ...config,
        runtime: "node",
        defaultsMode,
        authSchemePreference: config?.authSchemePreference ?? loadConfig(NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, loaderConfig),
        bodyLengthChecker: config?.bodyLengthChecker ?? calculateBodyLength,
        defaultUserAgentProvider: config?.defaultUserAgentProvider ?? createDefaultUserAgentProvider({ serviceId: clientSharedValues.serviceId, clientVersion: packageInfo.version }),
        maxAttempts: config?.maxAttempts ?? loadConfig(NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
        region: config?.region ?? loadConfig(NODE_REGION_CONFIG_OPTIONS, { ...NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
        requestHandler: NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
        retryMode: config?.retryMode ??
            loadConfig({
                ...NODE_RETRY_MODE_CONFIG_OPTIONS,
                default: async () => (await defaultConfigProvider()).retryMode || DEFAULT_RETRY_MODE,
            }, config),
        streamCollector: config?.streamCollector ?? streamCollector,
        useDualstackEndpoint: config?.useDualstackEndpoint ?? loadConfig(NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        useFipsEndpoint: config?.useFipsEndpoint ?? loadConfig(NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        userAgentAppId: config?.userAgentAppId ?? loadConfig(NODE_APP_ID_CONFIG_OPTIONS, loaderConfig),
    };
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
    const extensionConfiguration = Object.assign(getAwsRegionExtensionConfiguration(runtimeConfig), getDefaultExtensionConfiguration(runtimeConfig), getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
    extensions.forEach((extension) => extension.configure(extensionConfiguration));
    return Object.assign(runtimeConfig, resolveAwsRegionExtensionConfiguration(extensionConfiguration), resolveDefaultRuntimeConfig(extensionConfiguration), resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};

class CognitoIdentityClient extends Client {
    config;
    constructor(...[configuration]) {
        const _config_0 = getRuntimeConfig(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = resolveClientEndpointParameters(_config_0);
        const _config_2 = resolveUserAgentConfig(_config_1);
        const _config_3 = resolveRetryConfig(_config_2);
        const _config_4 = resolveRegionConfig(_config_3);
        const _config_5 = resolveHostHeaderConfig(_config_4);
        const _config_6 = resolveEndpointConfig(_config_5);
        const _config_7 = resolveHttpAuthSchemeConfig(_config_6);
        const _config_8 = resolveRuntimeExtensions(_config_7, configuration?.extensions || []);
        this.config = _config_8;
        this.middlewareStack.use(getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(getUserAgentPlugin(this.config));
        this.middlewareStack.use(getRetryPlugin(this.config));
        this.middlewareStack.use(getContentLengthPlugin(this.config));
        this.middlewareStack.use(getHostHeaderPlugin(this.config));
        this.middlewareStack.use(getLoggerPlugin(this.config));
        this.middlewareStack.use(getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: defaultCognitoIdentityHttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new DefaultIdentityProviderConfig({
                "aws.auth#sigv4": config.credentials,
            }),
        }));
        this.middlewareStack.use(getHttpSigningPlugin(this.config));
    }
    destroy() {
        super.destroy();
    }
}

const command = makeBuilder(commonParams, "AWSCognitoIdentityService", "CognitoIdentityClient", getEndpointPlugin);
const _ep0 = {};
const _mw0 = (Command, cs, config, o) => [];

class GetCredentialsForIdentityCommand extends command(_ep0, _mw0, "GetCredentialsForIdentity", GetCredentialsForIdentity$) {
}

class GetIdCommand extends command(_ep0, _mw0, "GetId", GetId$) {
}

const commands = {
    GetCredentialsForIdentityCommand,
    GetIdCommand,
};
class CognitoIdentity extends CognitoIdentityClient {
}
createAggregatedClient(commands, CognitoIdentity);

exports.CognitoIdentity = CognitoIdentity;
exports.CognitoIdentityClient = CognitoIdentityClient;
exports.CognitoIdentityServiceException = CognitoIdentityServiceException;
exports.CognitoIdentityServiceException$ = CognitoIdentityServiceException$;
exports.Credentials$ = Credentials$;
exports.ExternalServiceException = ExternalServiceException;
exports.ExternalServiceException$ = ExternalServiceException$;
exports.GetCredentialsForIdentity$ = GetCredentialsForIdentity$;
exports.GetCredentialsForIdentityCommand = GetCredentialsForIdentityCommand;
exports.GetCredentialsForIdentityInput$ = GetCredentialsForIdentityInput$;
exports.GetCredentialsForIdentityResponse$ = GetCredentialsForIdentityResponse$;
exports.GetId$ = GetId$;
exports.GetIdCommand = GetIdCommand;
exports.GetIdInput$ = GetIdInput$;
exports.GetIdResponse$ = GetIdResponse$;
exports.InternalErrorException = InternalErrorException;
exports.InternalErrorException$ = InternalErrorException$;
exports.InvalidIdentityPoolConfigurationException = InvalidIdentityPoolConfigurationException;
exports.InvalidIdentityPoolConfigurationException$ = InvalidIdentityPoolConfigurationException$;
exports.InvalidParameterException = InvalidParameterException;
exports.InvalidParameterException$ = InvalidParameterException$;
exports.LimitExceededException = LimitExceededException;
exports.LimitExceededException$ = LimitExceededException$;
exports.NotAuthorizedException = NotAuthorizedException;
exports.NotAuthorizedException$ = NotAuthorizedException$;
exports.ResourceConflictException = ResourceConflictException;
exports.ResourceConflictException$ = ResourceConflictException$;
exports.ResourceNotFoundException = ResourceNotFoundException;
exports.ResourceNotFoundException$ = ResourceNotFoundException$;
exports.TooManyRequestsException = TooManyRequestsException;
exports.TooManyRequestsException$ = TooManyRequestsException$;
exports.errorTypeRegistries = errorTypeRegistries;


/***/ })

};
