"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WinPackager = void 0;
const bluebird_lst_1 = require("bluebird-lst");
const builder_util_1 = require("builder-util");
const builder_util_runtime_1 = require("builder-util-runtime");
const fs_1 = require("builder-util/out/fs");
const crypto_1 = require("crypto");
const fs_extra_1 = require("fs-extra");
const is_ci_1 = require("is-ci");
const lazy_val_1 = require("lazy-val");
const path = require("path");
const codesign_1 = require("./codeSign/codesign");
const windowsCodeSign_1 = require("./codeSign/windowsCodeSign");
const core_1 = require("./core");
const platformPackager_1 = require("./platformPackager");
const NsisTarget_1 = require("./targets/nsis/NsisTarget");
const nsisUtil_1 = require("./targets/nsis/nsisUtil");
const WebInstallerTarget_1 = require("./targets/nsis/WebInstallerTarget");
const targetFactory_1 = require("./targets/targetFactory");
const cacheManager_1 = require("./util/cacheManager");
const flags_1 = require("./util/flags");
const timer_1 = require("./util/timer");
const vm_1 = require("./vm/vm");
const wine_1 = require("./wine");
class WinPackager extends platformPackager_1.PlatformPackager {
    constructor(info) {
        super(info, core_1.Platform.WINDOWS);
        this.cscInfo = new lazy_val_1.Lazy(() => {
            const platformSpecificBuildOptions = this.platformSpecificBuildOptions;
            if (platformSpecificBuildOptions.certificateSubjectName != null || platformSpecificBuildOptions.certificateSha1 != null) {
                return this.vm.value
                    .then(vm => windowsCodeSign_1.getCertificateFromStoreInfo(platformSpecificBuildOptions, vm))
                    .catch(e => {
                    // https://github.com/electron-userland/electron-builder/pull/2397
                    if (platformSpecificBuildOptions.sign == null) {
                        throw e;
                    }
                    else {
                        builder_util_1.log.debug({ error: e }, "getCertificateFromStoreInfo error");
                        return null;
                    }
                });
            }
            const certificateFile = platformSpecificBuildOptions.certificateFile;
            if (certificateFile != null) {
                const certificatePassword = this.getCscPassword();
                return Promise.resolve({
                    file: certificateFile,
                    password: certificatePassword == null ? null : certificatePassword.trim(),
                });
            }
            const cscLink = this.getCscLink("WIN_CSC_LINK");
            if (cscLink == null) {
                return Promise.resolve(null);
            }
            return (codesign_1.downloadCertificate(cscLink, this.info.tempDirManager, this.projectDir)
                // before then
                .catch(e => {
                if (e instanceof builder_util_1.InvalidConfigurationError) {
                    throw new builder_util_1.InvalidConfigurationError(`Env WIN_CSC_LINK is not correct, cannot resolve: ${e.message}`);
                }
                else {
                    throw e;
                }
            })
                .then(path => {
                return {
                    file: path,
                    password: this.getCscPassword(),
                };
            }));
        });
        this._iconPath = new lazy_val_1.Lazy(() => this.getOrConvertIcon("ico"));
        this.vm = new lazy_val_1.Lazy(() => (process.platform === "win32" ? Promise.resolve(new vm_1.VmManager()) : vm_1.getWindowsVm(this.debugLogger)));
        this.computedPublisherName = new lazy_val_1.Lazy(async () => {
            const publisherName = this.platformSpecificBuildOptions.publisherName;
            if (publisherName === null) {
                return null;
            }
            else if (publisherName != null) {
                return builder_util_1.asArray(publisherName);
            }
            const certInfo = await this.lazyCertInfo.value;
            return certInfo == null ? null : [certInfo.commonName];
        });
        this.lazyCertInfo = new lazy_val_1.Lazy(async () => {
            const cscInfo = await this.cscInfo.value;
            if (cscInfo == null) {
                return null;
            }
            if ("subject" in cscInfo) {
                const bloodyMicrosoftSubjectDn = cscInfo.subject;
                return {
                    commonName: builder_util_runtime_1.parseDn(bloodyMicrosoftSubjectDn).get("CN"),
                    bloodyMicrosoftSubjectDn,
                };
            }
            const cscFile = cscInfo.file;
            if (cscFile == null) {
                return null;
            }
            return await windowsCodeSign_1.getCertInfo(cscFile, cscInfo.password || "");
        });
    }
    get isForceCodeSigningVerification() {
        return this.platformSpecificBuildOptions.verifyUpdateCodeSignature !== false;
    }
    get defaultTarget() {
        return ["nsis"];
    }
    doGetCscPassword() {
        return platformPackager_1.chooseNotNull(platformPackager_1.chooseNotNull(this.platformSpecificBuildOptions.certificatePassword, process.env.WIN_CSC_KEY_PASSWORD), super.doGetCscPassword());
    }
    createTargets(targets, mapper) {
        let copyElevateHelper;
        const getCopyElevateHelper = () => {
            if (copyElevateHelper == null) {
                copyElevateHelper = new nsisUtil_1.CopyElevateHelper();
            }
            return copyElevateHelper;
        };
        let helper;
        const getHelper = () => {
            if (helper == null) {
                helper = new nsisUtil_1.AppPackageHelper(getCopyElevateHelper());
            }
            return helper;
        };
        for (const name of targets) {
            if (name === core_1.DIR_TARGET) {
                continue;
            }
            if (name === "nsis" || name === "portable") {
                mapper(name, outDir => new NsisTarget_1.NsisTarget(this, outDir, name, getHelper()));
            }
            else if (name === "nsis-web") {
                // package file format differs from nsis target
                mapper(name, outDir => new WebInstallerTarget_1.WebInstallerTarget(this, path.join(outDir, name), name, new nsisUtil_1.AppPackageHelper(getCopyElevateHelper())));
            }
            else {
                const targetClass = (() => {
                    switch (name) {
                        case "squirrel":
                            try {
                                return require("electron-builder-squirrel-windows").default;
                            }
                            catch (e) {
                                throw new builder_util_1.InvalidConfigurationError(`Module electron-builder-squirrel-windows must be installed in addition to build Squirrel.Windows: ${e.stack || e}`);
                            }
                        case "appx":
                            return require("./targets/AppxTarget").default;
                        case "msi":
                            return require("./targets/MsiTarget").default;
                        default:
                            return null;
                    }
                })();
                mapper(name, outDir => (targetClass === null ? targetFactory_1.createCommonTarget(name, outDir, this) : new targetClass(this, outDir, name)));
            }
        }
    }
    getIconPath() {
        return this._iconPath.value;
    }
    async sign(file, logMessagePrefix) {
        const signOptions = {
            path: file,
            name: this.appInfo.productName,
            site: await this.appInfo.computePackageUrl(),
            options: this.platformSpecificBuildOptions,
        };
        const cscInfo = await this.cscInfo.value;
        if (cscInfo == null) {
            if (this.platformSpecificBuildOptions.sign != null) {
                await windowsCodeSign_1.sign(signOptions, this);
            }
            else if (this.forceCodeSigning) {
                throw new builder_util_1.InvalidConfigurationError(`App is not signed and "forceCodeSigning" is set to true, please ensure that code signing configuration is correct, please see https://electron.build/code-signing`);
            }
            return;
        }
        if (logMessagePrefix == null) {
            logMessagePrefix = "signing";
        }
        if ("file" in cscInfo) {
            builder_util_1.log.info({
                file: builder_util_1.log.filePath(file),
                certificateFile: cscInfo.file,
            }, logMessagePrefix);
        }
        else {
            const info = cscInfo;
            builder_util_1.log.info({
                file: builder_util_1.log.filePath(file),
                subject: info.subject,
                thumbprint: info.thumbprint,
                store: info.store,
                user: info.isLocalMachineStore ? "local machine" : "current user",
            }, logMessagePrefix);
        }
        await this.doSign({
            ...signOptions,
            cscInfo,
            options: {
                ...this.platformSpecificBuildOptions,
            },
        });
    }
    async doSign(options) {
        for (let i = 0; i < 3; i++) {
            try {
                await windowsCodeSign_1.sign(options, this);
                break;
            }
            catch (e) {
                // https://github.com/electron-userland/electron-builder/issues/1414
                const message = e.message;
                if (message != null && message.includes("Couldn't resolve host name")) {
                    builder_util_1.log.warn({ error: message, attempt: i + 1 }, `cannot sign`);
                    continue;
                }
                throw e;
            }
        }
    }
    async signAndEditResources(file, arch, outDir, internalName, requestedExecutionLevel) {
        const appInfo = this.appInfo;
        const files = [];
        const args = [
            file,
            "--set-version-string",
            "FileDescription",
            appInfo.productName,
            "--set-version-string",
            "ProductName",
            appInfo.productName,
            "--set-version-string",
            "LegalCopyright",
            appInfo.copyright,
            "--set-file-version",
            appInfo.shortVersion || appInfo.buildVersion,
            "--set-product-version",
            appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
        ];
        if (internalName != null) {
            args.push("--set-version-string", "InternalName", internalName, "--set-version-string", "OriginalFilename", "");
        }
        if (requestedExecutionLevel != null && requestedExecutionLevel !== "asInvoker") {
            args.push("--set-requested-execution-level", requestedExecutionLevel);
        }
        builder_util_1.use(appInfo.companyName, it => args.push("--set-version-string", "CompanyName", it));
        builder_util_1.use(this.platformSpecificBuildOptions.legalTrademarks, it => args.push("--set-version-string", "LegalTrademarks", it));
        const iconPath = await this.getIconPath();
        builder_util_1.use(iconPath, it => {
            files.push(it);
            args.push("--set-icon", it);
        });
        const config = this.config;
        const cscInfoForCacheDigest = !flags_1.isBuildCacheEnabled() || is_ci_1.default || config.electronDist != null ? null : await this.cscInfo.value;
        let buildCacheManager = null;
        // resources editing doesn't change executable for the same input and executed quickly - no need to complicate
        if (cscInfoForCacheDigest != null) {
            const cscFile = cscInfoForCacheDigest.file;
            if (cscFile != null) {
                files.push(cscFile);
            }
            const timer = timer_1.time("executable cache");
            const hash = crypto_1.createHash("sha512");
            hash.update(config.electronVersion || "no electronVersion");
            hash.update(JSON.stringify(this.platformSpecificBuildOptions));
            hash.update(JSON.stringify(args));
            hash.update(this.platformSpecificBuildOptions.certificateSha1 || "no certificateSha1");
            hash.update(this.platformSpecificBuildOptions.certificateSubjectName || "no subjectName");
            buildCacheManager = new cacheManager_1.BuildCacheManager(outDir, file, arch);
            if (await buildCacheManager.copyIfValid(await cacheManager_1.digest(hash, files))) {
                timer.end();
                return;
            }
            timer.end();
        }
        const timer = timer_1.time("wine&sign");
        // rcedit crashed of executed using wine, resourcehacker works
        if (process.platform === "win32" || process.platform === "darwin") {
            await builder_util_1.executeAppBuilder(["rcedit", "--args", JSON.stringify(args)], undefined /* child-process */, {}, 3 /* retry three times */);
        }
        else if (this.info.framework.name === "electron") {
            const vendorPath = await windowsCodeSign_1.getSignVendorPath();
            await wine_1.execWine(path.join(vendorPath, "rcedit-ia32.exe"), path.join(vendorPath, "rcedit-x64.exe"), args);
        }
        await this.sign(file);
        timer.end();
        if (buildCacheManager != null) {
            await buildCacheManager.save();
        }
    }
    isSignDlls() {
        return this.platformSpecificBuildOptions.signDlls === true;
    }
    createTransformerForExtraFiles(packContext) {
        if (this.platformSpecificBuildOptions.signAndEditExecutable === false) {
            return null;
        }
        return file => {
            if (file.endsWith(".exe") || (this.isSignDlls() && file.endsWith(".dll"))) {
                const parentDir = path.dirname(file);
                if (parentDir !== packContext.appOutDir) {
                    return new fs_1.CopyFileTransformer(file => this.sign(file));
                }
            }
            return null;
        };
    }
    async signApp(packContext, isAsar) {
        const exeFileName = `${this.appInfo.productFilename}.exe`;
        if (this.platformSpecificBuildOptions.signAndEditExecutable === false) {
            return;
        }
        await bluebird_lst_1.default.map(fs_extra_1.readdir(packContext.appOutDir), (file) => {
            if (file === exeFileName) {
                return this.signAndEditResources(path.join(packContext.appOutDir, exeFileName), packContext.arch, packContext.outDir, path.basename(exeFileName, ".exe"), this.platformSpecificBuildOptions.requestedExecutionLevel);
            }
            else if (file.endsWith(".exe") || (this.isSignDlls() && file.endsWith(".dll"))) {
                return this.sign(path.join(packContext.appOutDir, file));
            }
            return null;
        });
        if (!isAsar) {
            return;
        }
        const outResourcesDir = path.join(packContext.appOutDir, "resources", "app.asar.unpacked");
        // noinspection JSUnusedLocalSymbols
        const fileToSign = await fs_1.walk(outResourcesDir, (file, stat) => stat.isDirectory() || file.endsWith(".exe") || (this.isSignDlls() && file.endsWith(".dll")));
        await bluebird_lst_1.default.map(fileToSign, file => this.sign(file), { concurrency: 4 });
    }
}
exports.WinPackager = WinPackager;
//# sourceMappingURL=winPackager.js.map