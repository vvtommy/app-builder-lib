"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BintrayPublisher = void 0;
const builder_util_1 = require("builder-util");
const builder_util_runtime_1 = require("builder-util-runtime");
const bintray_1 = require("builder-util-runtime/out/bintray");
const nodeHttpExecutor_1 = require("builder-util/out/nodeHttpExecutor");
const lazy_val_1 = require("lazy-val");
const electron_publish_1 = require("electron-publish");
class BintrayPublisher extends electron_publish_1.HttpPublisher {
    constructor(context, info, version, options = {}) {
        super(context);
        this.version = version;
        this.options = options;
        this._versionPromise = new lazy_val_1.Lazy(() => this.init());
        this.providerName = "Bintray";
        let token = info.token;
        if (builder_util_1.isEmptyOrSpaces(token)) {
            token = process.env.BT_TOKEN;
            if (builder_util_1.isEmptyOrSpaces(token)) {
                throw new builder_util_1.InvalidConfigurationError(`Bintray token is not set, neither programmatically, nor using env "BT_TOKEN" (see https://www.electron.build/configuration/publish#bintrayoptions)`);
            }
            token = token.trim();
            if (!builder_util_1.isTokenCharValid(token)) {
                throw new builder_util_1.InvalidConfigurationError(`Bintray token (${JSON.stringify(token)}) contains invalid characters, please check env "BT_TOKEN"`);
            }
        }
        this.client = new bintray_1.BintrayClient(info, nodeHttpExecutor_1.httpExecutor, this.context.cancellationToken, token);
    }
    async init() {
        try {
            return await this.client.getVersion(this.version);
        }
        catch (e) {
            if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
                if (this.options.publish !== "onTagOrDraft") {
                    builder_util_1.log.info({ version: this.version }, "version doesn't exist, creating one");
                    return await this.client.createVersion(this.version);
                }
                else {
                    builder_util_1.log.warn({ reason: "version doesn't exist", version: this.version }, "skipped publishing");
                }
            }
            throw e;
        }
    }
    async doUpload(fileName, arch, dataLength, requestProcessor) {
        const version = await this._versionPromise.value;
        if (version == null) {
            builder_util_1.log.warn({ file: fileName, reason: "version doesn't exist and is not created", version: this.version }, "skipped publishing");
            return;
        }
        const options = {
            hostname: "api.bintray.com",
            path: `/content/${this.client.owner}/${this.client.repo}/${this.client.packageName}/${encodeURI(`${version.name}/${fileName}`)}`,
            method: "PUT",
            headers: {
                "Content-Length": dataLength,
                "X-Bintray-Override": "1",
                "X-Bintray-Publish": "1",
                "X-Bintray-Debian-Architecture": builder_util_1.toLinuxArchString(arch, "deb"),
            },
        };
        if (this.client.distribution != null) {
            options.headers["X-Bintray-Debian-Distribution"] = this.client.distribution;
        }
        if (this.client.component != null) {
            options.headers["X-Bintray-Debian-Component"] = this.client.component;
        }
        for (let attemptNumber = 0;; attemptNumber++) {
            try {
                return await nodeHttpExecutor_1.httpExecutor.doApiRequest(builder_util_runtime_1.configureRequestOptions(options, this.client.auth), this.context.cancellationToken, requestProcessor);
            }
            catch (e) {
                if (attemptNumber < 3 && ((e instanceof builder_util_runtime_1.HttpError && e.statusCode === 502) || e.code === "EPIPE")) {
                    continue;
                }
                throw e;
            }
        }
    }
    //noinspection JSUnusedGlobalSymbols
    async deleteRelease(isForce = false) {
        if (!isForce && !this._versionPromise.hasValue) {
            return;
        }
        const version = await this._versionPromise.value;
        if (version != null) {
            await this.client.deleteVersion(version.name);
        }
    }
    toString() {
        return `Bintray (user: ${this.client.user || this.client.owner}, owner: ${this.client.owner},  package: ${this.client.packageName}, repository: ${this.client.repo}, version: ${this.version})`;
    }
}
exports.BintrayPublisher = BintrayPublisher;
//# sourceMappingURL=BintrayPublisher.js.map