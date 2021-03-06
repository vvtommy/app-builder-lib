"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWindowsInstallationDirName = exports.createStageDirPath = exports.createStageDir = exports.StageDir = void 0;
const path = require("path");
const builder_util_1 = require("builder-util");
const fs_1 = require("fs");
class StageDir {
    constructor(dir) {
        this.dir = dir;
    }
    getTempFile(name) {
        return this.dir + path.sep + name;
    }
    cleanup() {
        if (!builder_util_1.debug.enabled || process.env.ELECTRON_BUILDER_REMOVE_STAGE_EVEN_IF_DEBUG === "true") {
            return fs_1.promises.rmdir(this.dir, { recursive: true });
        }
        return Promise.resolve();
    }
    toString() {
        return this.dir;
    }
}
exports.StageDir = StageDir;
async function createStageDir(target, packager, arch) {
    return new StageDir(await createStageDirPath(target, packager, arch));
}
exports.createStageDir = createStageDir;
async function createStageDirPath(target, packager, arch) {
    const tempDir = packager.info.stageDirPathCustomizer(target, packager, arch);
    await fs_1.promises.rmdir(tempDir, { recursive: true });
    await fs_1.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
}
exports.createStageDirPath = createStageDirPath;
// https://github.com/electron-userland/electron-builder/issues/3100
// https://github.com/electron-userland/electron-builder/commit/2539cfba20dc639128e75c5b786651b652bb4b78
function getWindowsInstallationDirName(appInfo, isTryToUseProductName) {
    return isTryToUseProductName && /^[-_+0-9a-zA-Z .]+$/.test(appInfo.productFilename) ? appInfo.productFilename : appInfo.sanitizedName;
}
exports.getWindowsInstallationDirName = getWindowsInstallationDirName;
//# sourceMappingURL=targetUtil.js.map