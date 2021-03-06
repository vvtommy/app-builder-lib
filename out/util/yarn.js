"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuild = exports.nodeGypRebuild = exports.getGypEnv = exports.installOrRebuild = void 0;
const builder_util_1 = require("builder-util");
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path = require("path");
const appBuilder_1 = require("./appBuilder");
async function installOrRebuild(config, appDir, options, forceInstall = false) {
    const effectiveOptions = {
        buildFromSource: config.buildDependenciesFromSource === true,
        additionalArgs: builder_util_1.asArray(config.npmArgs),
        ...options,
    };
    let isDependenciesInstalled = false;
    for (const fileOrDir of ["node_modules", ".pnp.js"]) {
        if (await fs_extra_1.pathExists(path.join(appDir, fileOrDir))) {
            isDependenciesInstalled = true;
            break;
        }
    }
    if (forceInstall || !isDependenciesInstalled) {
        await installDependencies(appDir, effectiveOptions);
    }
    else {
        await rebuild(appDir, effectiveOptions);
    }
}
exports.installOrRebuild = installOrRebuild;
function getElectronGypCacheDir() {
    return path.join(os_1.homedir(), ".electron-gyp");
}
function getGypEnv(frameworkInfo, platform, arch, buildFromSource) {
    const npmConfigArch = arch === "armv7l" ? "arm" : arch;
    const common = {
        ...process.env,
        npm_config_arch: npmConfigArch,
        npm_config_target_arch: npmConfigArch,
        npm_config_platform: platform,
        npm_config_build_from_source: buildFromSource,
        // required for node-pre-gyp
        npm_config_target_platform: platform,
        npm_config_update_binary: true,
        npm_config_fallback_to_build: true,
    };
    if (platform !== process.platform) {
        common.npm_config_force = "true";
    }
    if (platform === "win32" || platform === "darwin") {
        common.npm_config_target_libc = "unknown";
    }
    if (!frameworkInfo.useCustomDist) {
        return common;
    }
    // https://github.com/nodejs/node-gyp/issues/21
    return {
        ...common,
        npm_config_disturl: "https://electronjs.org/headers",
        npm_config_target: frameworkInfo.version,
        npm_config_runtime: "electron",
        npm_config_devdir: getElectronGypCacheDir(),
    };
}
exports.getGypEnv = getGypEnv;
function installDependencies(appDir, options) {
    const platform = options.platform || process.platform;
    const arch = options.arch || process.arch;
    const additionalArgs = options.additionalArgs;
    builder_util_1.log.info({ platform, arch, appDir }, `installing production dependencies`);
    let execPath = process.env.npm_execpath || process.env.NPM_CLI_JS;
    const execArgs = ["install"];
    const npmUserAgent = process.env["npm_config_user_agent"];
    const isYarn2 = npmUserAgent != null && npmUserAgent.startsWith("yarn/2.");
    if (!isYarn2) {
        if (process.env.NPM_NO_BIN_LINKS === "true") {
            execArgs.push("--no-bin-links");
        }
        execArgs.push("--production");
    }
    if (!isRunningYarn(execPath)) {
        execArgs.push("--cache-min", "999999999");
    }
    if (execPath == null) {
        execPath = getPackageToolPath();
    }
    else if (!isYarn2) {
        execArgs.unshift(execPath);
        execPath = process.env.npm_node_execpath || process.env.NODE_EXE || "node";
    }
    if (additionalArgs != null) {
        execArgs.push(...additionalArgs);
    }
    return builder_util_1.spawn(execPath, execArgs, {
        cwd: appDir,
        env: getGypEnv(options.frameworkInfo, platform, arch, options.buildFromSource === true),
    });
}
async function nodeGypRebuild(platform, arch, frameworkInfo) {
    builder_util_1.log.info({ platform, arch }, "executing node-gyp rebuild");
    // this script must be used only for electron
    const nodeGyp = `node-gyp${process.platform === "win32" ? ".cmd" : ""}`;
    await builder_util_1.spawn(nodeGyp, ["rebuild"], { env: getGypEnv(frameworkInfo, platform, arch, true) });
}
exports.nodeGypRebuild = nodeGypRebuild;
function getPackageToolPath() {
    if (process.env.FORCE_YARN === "true") {
        return process.platform === "win32" ? "yarn.cmd" : "yarn";
    }
    else {
        return process.platform === "win32" ? "npm.cmd" : "npm";
    }
}
function isRunningYarn(execPath) {
    const userAgent = process.env.npm_config_user_agent;
    return process.env.FORCE_YARN === "true" || (execPath != null && path.basename(execPath).startsWith("yarn")) || (userAgent != null && /\byarn\b/.test(userAgent));
}
/** @internal */
async function rebuild(appDir, options) {
    const configuration = {
        dependencies: await options.productionDeps.value,
        nodeExecPath: process.execPath,
        platform: options.platform || process.platform,
        arch: options.arch || process.arch,
        additionalArgs: options.additionalArgs,
        execPath: process.env.npm_execpath || process.env.NPM_CLI_JS,
        buildFromSource: options.buildFromSource === true,
    };
    const env = getGypEnv(options.frameworkInfo, configuration.platform, configuration.arch, options.buildFromSource === true);
    await appBuilder_1.executeAppBuilderAndWriteJson(["rebuild-node-modules"], configuration, { env, cwd: appDir });
}
exports.rebuild = rebuild;
//# sourceMappingURL=yarn.js.map