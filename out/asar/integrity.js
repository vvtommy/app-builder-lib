"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeData = void 0;
const bluebird_lst_1 = require("bluebird-lst");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const fs_extra_1 = require("fs-extra");
const path = require("path");
async function computeData(resourcesPath, options) {
    // sort to produce constant result
    const names = (await fs_extra_1.readdir(resourcesPath)).filter(it => it.endsWith(".asar")).sort();
    const checksums = await bluebird_lst_1.default.map(names, it => hashFile(path.join(resourcesPath, it)));
    const result = {};
    for (let i = 0; i < names.length; i++) {
        result[names[i]] = checksums[i];
    }
    return { checksums: result, ...options };
}
exports.computeData = computeData;
function hashFile(file, algorithm = "sha512", encoding = "base64") {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.createHash(algorithm);
        hash.on("error", reject).setEncoding(encoding);
        fs_1.createReadStream(file)
            .on("error", reject)
            .on("end", () => {
            hash.end();
            resolve(hash.read());
        })
            .pipe(hash, { end: false });
    });
}
//# sourceMappingURL=integrity.js.map