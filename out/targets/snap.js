"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const builder_util_1 = require("builder-util");
const builder_util_runtime_1 = require("builder-util-runtime");
const fs_extra_1 = require("fs-extra");
const js_yaml_1 = require("js-yaml");
const path = require("path");
const semver = require("semver");
const core_1 = require("../core");
const pathManager_1 = require("../util/pathManager");
const targetUtil_1 = require("./targetUtil");
const defaultPlugs = ["desktop", "desktop-legacy", "home", "x11", "wayland", "unity7", "browser-support", "network", "gsettings", "audio-playback", "pulseaudio", "opengl"];
class SnapTarget extends core_1.Target {
    constructor(name, packager, helper, outDir) {
        super(name);
        this.packager = packager;
        this.helper = helper;
        this.outDir = outDir;
        this.options = { ...this.packager.platformSpecificBuildOptions, ...this.packager.config[this.name] };
        this.isUseTemplateApp = false;
    }
    replaceDefault(inList, defaultList) {
        const result = builder_util_1.replaceDefault(inList, defaultList);
        if (result !== defaultList) {
            this.isUseTemplateApp = false;
        }
        return result;
    }
    async createDescriptor(arch) {
        if (!this.isElectronVersionGreaterOrEqualThan("4.0.0")) {
            if (!this.isElectronVersionGreaterOrEqualThan("2.0.0-beta.1")) {
                throw new builder_util_1.InvalidConfigurationError("Electron 2 and higher is required to build Snap");
            }
            builder_util_1.log.warn("Electron 4 and higher is highly recommended for Snap");
        }
        const appInfo = this.packager.appInfo;
        const snapName = this.packager.executableName.toLowerCase();
        const options = this.options;
        const plugs = normalizePlugConfiguration(this.options.plugs);
        const plugNames = this.replaceDefault(plugs == null ? null : Object.getOwnPropertyNames(plugs), defaultPlugs);
        const slots = normalizePlugConfiguration(this.options.slots);
        const buildPackages = builder_util_runtime_1.asArray(options.buildPackages);
        const defaultStagePackages = getDefaultStagePackages();
        const stagePackages = this.replaceDefault(options.stagePackages, defaultStagePackages);
        this.isUseTemplateApp =
            this.options.useTemplateApp !== false &&
                (arch === builder_util_1.Arch.x64 || arch === builder_util_1.Arch.armv7l) &&
                buildPackages.length === 0 &&
                isArrayEqualRegardlessOfSort(stagePackages, defaultStagePackages);
        const appDescriptor = {
            command: "command.sh",
            plugs: plugNames,
            adapter: "none",
        };
        const snap = js_yaml_1.load(await fs_extra_1.readFile(path.join(pathManager_1.getTemplatePath("snap"), "snapcraft.yaml"), "utf-8"));
        if (this.isUseTemplateApp) {
            delete appDescriptor.adapter;
        }
        if (options.grade != null) {
            snap.grade = options.grade;
        }
        if (options.confinement != null) {
            snap.confinement = options.confinement;
        }
        if (options.appPartStage != null) {
            snap.parts.app.stage = options.appPartStage;
        }
        if (options.layout != null) {
            snap.layout = options.layout;
        }
        if (slots != null) {
            appDescriptor.slots = Object.getOwnPropertyNames(slots);
            for (const slotName of appDescriptor.slots) {
                const slotOptions = slots[slotName];
                if (slotOptions == null) {
                    continue;
                }
                if (!snap.slots) {
                    snap.slots = {};
                }
                snap.slots[slotName] = slotOptions;
            }
        }
        builder_util_1.deepAssign(snap, {
            name: snapName,
            version: appInfo.version,
            title: options.title || appInfo.productName,
            summary: options.summary || appInfo.productName,
            description: this.helper.getDescription(options),
            architectures: [builder_util_1.toLinuxArchString(arch, "snap")],
            apps: {
                [snapName]: appDescriptor,
            },
            parts: {
                app: {
                    "stage-packages": stagePackages,
                },
            },
        });
        if (options.autoStart) {
            appDescriptor.autostart = `${snap.name}.desktop`;
        }
        if (options.confinement === "classic") {
            delete appDescriptor.plugs;
            delete snap.plugs;
        }
        else {
            const archTriplet = archNameToTriplet(arch);
            appDescriptor.environment = {
                // https://github.com/electron-userland/electron-builder/issues/4007
                // https://github.com/electron/electron/issues/9056
                DISABLE_WAYLAND: "1",
                TMPDIR: "$XDG_RUNTIME_DIR",
                PATH: "$SNAP/usr/sbin:$SNAP/usr/bin:$SNAP/sbin:$SNAP/bin:$PATH",
                SNAP_DESKTOP_RUNTIME: "$SNAP/gnome-platform",
                LD_LIBRARY_PATH: [
                    "$SNAP_LIBRARY_PATH",
                    "$SNAP/lib:$SNAP/usr/lib:$SNAP/lib/" + archTriplet + ":$SNAP/usr/lib/" + archTriplet,
                    "$LD_LIBRARY_PATH:$SNAP/lib:$SNAP/usr/lib",
                    "$SNAP/lib/" + archTriplet + ":$SNAP/usr/lib/" + archTriplet,
                ].join(":"),
                ...options.environment,
            };
            if (plugs != null) {
                for (const plugName of plugNames) {
                    const plugOptions = plugs[plugName];
                    if (plugOptions == null) {
                        continue;
                    }
                    snap.plugs[plugName] = plugOptions;
                }
            }
        }
        if (buildPackages.length > 0) {
            snap.parts.app["build-packages"] = buildPackages;
        }
        if (options.after != null) {
            snap.parts.app.after = options.after;
        }
        if (options.assumes != null) {
            snap.assumes = builder_util_runtime_1.asArray(options.assumes);
        }
        return snap;
    }
    async build(appOutDir, arch) {
        const packager = this.packager;
        const options = this.options;
        // tslint:disable-next-line:no-invalid-template-strings
        const artifactName = packager.expandArtifactNamePattern(this.options, "snap", arch, "${name}_${version}_${arch}.${ext}", false);
        const artifactPath = path.join(this.outDir, artifactName);
        await packager.info.callArtifactBuildStarted({
            targetPresentableName: "snap",
            file: artifactPath,
            arch,
        });
        const snap = await this.createDescriptor(arch);
        if (this.isUseTemplateApp) {
            delete snap.parts;
        }
        const stageDir = await targetUtil_1.createStageDirPath(this, packager, arch);
        const snapArch = builder_util_1.toLinuxArchString(arch, "snap");
        const args = ["snap", "--app", appOutDir, "--stage", stageDir, "--arch", snapArch, "--output", artifactPath, "--executable", this.packager.executableName];
        await this.helper.icons;
        if (this.helper.maxIconPath != null) {
            if (!this.isUseTemplateApp) {
                snap.icon = "snap/gui/icon.png";
            }
            args.push("--icon", this.helper.maxIconPath);
        }
        // snapcraft.yaml inside a snap directory
        const snapMetaDir = path.join(stageDir, this.isUseTemplateApp ? "meta" : "snap");
        const desktopFile = path.join(snapMetaDir, "gui", `${snap.name}.desktop`);
        await this.helper.writeDesktopEntry(this.options, packager.executableName + " %U", desktopFile, {
            // tslint:disable:no-invalid-template-strings
            Icon: "${SNAP}/meta/gui/icon.png",
        });
        if (this.isElectronVersionGreaterOrEqualThan("5.0.0") && !isBrowserSandboxAllowed(snap)) {
            args.push("--extraAppArgs=--no-sandbox");
            if (this.isUseTemplateApp) {
                args.push("--exclude", "chrome-sandbox");
            }
        }
        if (packager.packagerOptions.effectiveOptionComputed != null && (await packager.packagerOptions.effectiveOptionComputed({ snap, desktopFile, args }))) {
            return;
        }
        await fs_extra_1.outputFile(path.join(snapMetaDir, this.isUseTemplateApp ? "snap.yaml" : "snapcraft.yaml"), builder_util_1.serializeToYaml(snap));
        const hooksDir = await packager.getResource(options.hooks, "snap-hooks");
        if (hooksDir != null) {
            args.push("--hooks", hooksDir);
        }
        if (this.isUseTemplateApp) {
            args.push("--template-url", `electron4:${snapArch}`);
        }
        await builder_util_1.executeAppBuilder(args);
        await packager.info.callArtifactBuildCompleted({
            file: artifactPath,
            safeArtifactName: packager.computeSafeArtifactName(artifactName, "snap", arch, false),
            target: this,
            arch,
            packager,
            publishConfig: options.publish == null ? { provider: "snapStore" } : null,
        });
    }
    isElectronVersionGreaterOrEqualThan(version) {
        return semver.gte(this.packager.config.electronVersion || "7.0.0", version);
    }
}
exports.default = SnapTarget;
function archNameToTriplet(arch) {
    switch (arch) {
        case builder_util_1.Arch.x64:
            return "x86_64-linux-gnu";
        case builder_util_1.Arch.ia32:
            return "i386-linux-gnu";
        case builder_util_1.Arch.armv7l:
            // noinspection SpellCheckingInspection
            return "arm-linux-gnueabihf";
        case builder_util_1.Arch.arm64:
            return "aarch64-linux-gnu";
        default:
            throw new Error(`Unsupported arch ${arch}`);
    }
}
function isArrayEqualRegardlessOfSort(a, b) {
    a = a.slice();
    b = b.slice();
    a.sort();
    b.sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
function normalizePlugConfiguration(raw) {
    if (raw == null) {
        return null;
    }
    const result = {};
    for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (typeof item === "string") {
            result[item] = null;
        }
        else {
            Object.assign(result, item);
        }
    }
    return result;
}
function isBrowserSandboxAllowed(snap) {
    if (snap.plugs != null) {
        for (const plugName of Object.keys(snap.plugs)) {
            const plug = snap.plugs[plugName];
            if (plug.interface === "browser-support" && plug["allow-sandbox"] === true) {
                return true;
            }
        }
    }
    return false;
}
function getDefaultStagePackages() {
    // libxss1 - was "error while loading shared libraries: libXss.so.1" on Xubuntu 16.04
    // noinspection SpellCheckingInspection
    return ["libnspr4", "libnss3", "libxss1", "libappindicator3-1", "libsecret-1-0"];
}
//# sourceMappingURL=snap.js.map