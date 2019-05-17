const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const glob = require('glob');
const gzipSize = require('gzip-size');
const { keypath } = require('@chialab/proteins');
const inquirer = require('inquirer');
const PackageManager = require('./PackageManager');
const Git = require('./Git');

/**
 * @typedef {Object} FileSize
 * @property {number} size The original size.
 * @property {number} zipped The gzipped size.
 */

/**
 * Prettify byte size.
 *
 * @param {number} size The file size in bytes.
 * @return {string} The size with the correct unit.
 */
function prettyBytes(size) {
    size = Math.abs(size);

    const KILO = 1024;
    const MEGA = KILO ** 2;
    const TERA = KILO ** 3;

    if (size > TERA) {
        return `${(size / TERA).toFixed(1)} TB`;
    } else if (size > MEGA) {
        return `${(size / MEGA).toFixed(1)} MB`;
    } else if (size > KILO) {
        return `${(size / KILO).toFixed(1)} KB`;
    }
    return `${size} B`;
}

/**
 * @class Entry
 * A file reference with some utils methods.
 * @property {string} path The file path.
 */
class Entry {
    /**
     * Create a Entry.
     * @param {string} file The absolute file path.
     * @return {Entry}
     */
    constructor(file) {
        this.path = file;
    }

    /**
     * The file basename.
     * @type {string}
     */
    get name() {
        return path.basename(this.path);
    }

    /**
     * The file name without extname.
     * @type {string}
     */
    get basename() {
        return path.basename(this.path, this.extname);
    }

    /**
     * The file basename.
     * @type {string}
     */
    get extname() {
        return path.extname(this.path);
    }

    /**
     * The file dirname.
     * @type {string}
     */
    get dirname() {
        return path.dirname(this.path);
    }

    /**
     * The file size.
     * @type {FileSize}
     */
    get size() {
        let sizes = {
            size: new Number(fs.statSync(this.path).size),
            zipped: new Number(gzipSize.fileSync(this.path)),
        };

        function bytesToString() {
            let value = parseInt(Number.prototype.toString.call(this));
            return prettyBytes(value);
        }

        sizes.size.toString = bytesToString;
        sizes.zipped.toString = bytesToString;

        return sizes;
    }

    /**
     * The file local path relative to project.
     * @type {string}
     */
    get localPath() {
        let project = this.project;
        if (project) {
            return path.relative(project.path, this.path);
        }
        return this.path;
    }

    /**
     * The parent directory reference.
     * @type {Directory}
     */
    get parent() {
        if (!this.dirname) {
            return null;
        }
        return new Directory(this.dirname);
    }

    /**
     * The NPM project of the file.
     * @type {Project}
     */
    get project() {
        let projectPath = this;
        if (projectPath instanceof File) {
            projectPath = projectPath.parent;
        }
        let packageJsonFile;
        while (projectPath) {
            if (projectPath instanceof Project) {
                return projectPath;
            }
            packageJsonFile = projectPath.file('package.json');
            if (packageJsonFile.exists()) {
                return new Project(projectPath.path);
            }
            projectPath = projectPath.parent;
        }
        return null;
    }

    /**
     * Get a path relative to the file reference.
     * @param {string|Entry} file The relative file.
     * @return {string} The relative file path.
     */
    relative(file) {
        if (file instanceof Entry) {
            file = file.path;
        }
        return path.relative(this.path, file);
    }

    /**
     * Check if the reference is a file.
     * @return {boolean}
     */
    isFile() {
        return fs.statSync(this.path).isFile();
    }

    /**
     * Check if the reference is a directory.
     * @return {boolean}
     */
    isDirectory() {
        return fs.statSync(this.path).isDirectory();
    }

    /**
     * Check if the reference exists.
     * @return {boolean}
     */
    exists() {
        return fs.existsSync(this.path);
    }

    /**
     * Remove the file if exists.
     * @return {void}
     */
    unlink() {
        if (this.exists()) {
            fs.removeSync(this.path);
        }
    }

    /**
     * Change file extension.
     * @param {string} ext The new extension.
     * @return {void}
     */
    ext(ext) {
        return this.rename(`${this.basename}${ext}`, false);
    }

    /**
     * Rename the file.
     * @param {string} name The new name.
     * @return {void}
     */
    rename(name, move = true) {
        let dest = path.join(this.dirname, name);
        let clone = new this.constructor(dest);
        if (this.exists() && move) {
            this.move(clone);
        }
        return clone;
    }

    /**
     * Copy a file to a new position.
     */
    copy(to) {
        if (to instanceof Entry) {
            to = to.path;
        }
        fs.copySync(this.path, to, {
            overwrite: true,
        });
        this.path = to;
    }

    /**
     * Move a file to a new position.
     */
    move(to) {
        if (to instanceof Entry) {
            to = to.path;
        }
        fs.moveSync(this.path, to, {
            overwrite: true,
        });
        this.path = to;
    }
}

/**
 * @class File
 * @extends Entry
 * A Entry which represent a File.
 */
class File extends Entry {
    /**
     * The map file reference for the current file.
     * @type {File}
     */
    get mapFile() {
        return this.ext(`${this.extname}.map`);
    }

    /**
     * The md5 hash of the file.
     * @return {string}
     */
    hash() {
        const BUFFER_SIZE = 8192;
        const fd = fs.openSync(this.path, 'r');
        const hash = crypto.createHash('md5');
        const buffer = Buffer.alloc(BUFFER_SIZE);

        try {
            let bytesRead;
            do {
                bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE);
                hash.update(buffer.slice(0, bytesRead));
            } while (bytesRead === BUFFER_SIZE);
        } finally {
            fs.closeSync(fd);
        }

        return hash.digest('hex');
    }

    /**
     * Read file content.
     * @return {string}
     */
    read() {
        try {
            return fs.readFileSync(this.path, 'utf8');
        } catch (err) {
            return null;
        }
    }

    /**
     * Write file content.
     * @param {string} content The content to write.
     * @return {void}
     */
    write(content) {
        fs.ensureDirSync(path.dirname(this.path));
        fs.writeFileSync(this.path, content);
    }

    /**
     * Read file content as JSON.
     * @return {Object}
     */
    readJson() {
        let data = this.read();
        if (data) {
            data = JSON.parse(data);
        }
        return data;
    }

    /**
     * Write file content as JSON.
     * @param {Object} data The JSON to write.
     * @return {void}
     */
    writeJson(data) {
        this.write(JSON.stringify(data, null, 2));
    }
}

/**
 * @class Directory
 * @extends Entry
 * A Entry which represent a Directory.
 */
class Directory extends Entry {
    /**
     * Ensure the directory to exists.
     * @return {void}
     */
    ensure() {
        fs.ensureDirSync(this.path);
    }

    /**
     * Empty the directory.
     * @return {void}
     */
    empty() {
        fs.emptyDirSync(this.path);
    }

    /**
     * Resolve glob patterns relative to the directory.
     * @param {Array<string>|string} patterns Glob patterns.
     * @return {Array<File|Directory>} A list of resolved entries.
     */
    resolve(patterns) {
        let files = [];
        if (!Array.isArray(patterns)) {
            patterns = [patterns];
        }

        patterns.forEach((pattern) => {
            glob.sync(pattern, {
                cwd: this.path,
                absolute: true,
            }).forEach((file) => {
                if (!files.includes(file)) {
                    files.push(file);
                }
            });
        });

        return files.map((file) => {
            let stats = fs.statSync(file);
            if (stats.isDirectory()) {
                return new Directory(file);
            } else if (stats.isFile()) {
                return new File(file);
            }
        }).filter(Boolean);
    }

    /**
     * Get a child entry for the directory.
     * @param {string} file The child reference path.
     * @return {Entry}
     */
    entry(file) {
        return new Entry(path.resolve(this.path, file));
    }

    /**
     * Get a child file for the directory.
     * @param {string} file The child file path.
     * @return {File}
     */
    file(file) {
        return new File(path.resolve(this.path, file));
    }

    /**
     * Get a child directory for the directory.
     * @param {string} directory The child directory path.
     * @return {Directory}
     */
    directory(directory) {
        return new Directory(path.resolve(this.path, directory));
    }

    /**
     * Get directory children entries list.
     * @return {Array<File|Directory>}
     */
    children() {
        if (!this.exists()) {
            return null;
        }

        let children = fs.readdirSync(this.path);
        return children.map((file) => {
            let entry = this.entry(file);
            if (entry.isDirectory()) {
                return this.directory(file);
            }
            return this.file(file);
        });
    }

    /**
     * Get directory children files list.
     * @return {Array<File>}
     */
    files() {
        if (!this.exists()) {
            return null;
        }

        return this.children().filter((entry) => entry.isFile());
    }

    /**
     * Get directory children directories list.
     * @return {Array<Directory>}
     */
    directories() {
        if (!this.exists()) {
            return null;
        }

        return this.children().filter((entry) => entry.isDirectory());
    }
}

/**
 * @class Project
 * @extends Directory
 * A Node project reference.
 */
class Project extends Directory {
    /**
     * Create a new project reference.
     * @param {string} root The root of the project.
     * @return {Project}
     */
    constructor(root) {
        super(root);
        // instantiate a package manager instance for project.
        this.packageManager = new PackageManager(root);
        // create a reference to the package.json file.
        this.packageJson = this.file('package.json');
        // load package.json if exists.
        if (this.packageJson.exists()) {
            this.load();
        } else {
            // setup a new project using root base name.
            this.json = {
                name: path.basename(root).toLowerCase().replace(/\s+/g, '_'),
            };
        }

        // git client instance
        let parent = this.parent;
        this.git = new Git(parent ? parent.path : root);
    }

    /**
     * Get the name of the scope (for scoped packages).
     * @type {string}
     */
    get scopeName() {
        return this.get('name').split('/').shift().toLowerCase();
    }

    /**
     * Get the name of the module (for scoped packages).
     * @type {string}
     */
    get scopeModule() {
        return this.get('name').split('/').pop().toLowerCase();
    }

    /**
     * Check if project has not been created yet.
     * @type {boolean}
     */
    get isNew() {
        return !this.packageJson.exists();
    }

    /**
     * The parent Project reference if in workspace.
     * @type {Project}
     */
    get parent() {
        let paths = this.path.split(path.sep).slice(0, -1);
        while (paths.length) {
            paths.pop();
            let superProject = new Project(paths.join(path.sep));
            if (superProject.isNew) {
                // current directory is not a Project.
                continue;
            }
            let workspaces = superProject.workspaces;
            if (!workspaces) {
                // current Project has not workspaces.
                break;
            }
            if (!workspaces.some((ws) => ws.path === this.path)) {
                // the context project is not a workspace of the current Project.
                break;
            }
            // The current Project is the parent of the context one.
            return superProject;
        }
        return null;
    }

    /**
     * Get directories references from `directories` field in package.json.
     * @type {Array<Directory>}
     */
    get directories() {
        let config = this.get('directories') || {};
        let directories = {};
        for (let key in config) {
            directories[key] = this.directory(config[key]);
        }
        return directories;
    }

    /**
     * Get workspaces Project references if Project is monorepo.
     * @type {Array<Project>}
     */
    get workspaces() {
        let workspaces = this.get('workspaces');
        if (!workspaces) {
            // the current project is not a monorepo.
            return null;
        }
        let directories = [];
        // find workspaces roots.
        workspaces.forEach((ws) => {
            directories.push(...super.resolve(ws, false));
        });
        // transform directories into projects.
        return directories
            .filter((entry) => entry instanceof Directory)
            .map((entry) => new Project(entry.path));
    }

    /**
     * The browserslist query for the current project.
     * @type {Array<string>}
     */
    get browserslist() {
        if (this.file('browserslist.json').exists()) {
            // browserslist.json exists in the root of the project.
            return this.file('browserslist.json').readJson();
        }

        if (this.get('browserslist')) {
            // found browserslist field in package.json.
            return this.get('browserslist');
        }

        let parent = this.parent;
        if (parent) {
            // use parent query if in monorepo.
            return parent.browserslist;
        }

        // use default query.
        return [
            'ie >= 11',
            'last 3 iOS major versions',
            'Android >= 4.4',
            'last 3 Safari major versions',
            'last 3 Firefox major versions',
            'unreleased Firefox versions',
            'Chrome 45',
            'last 3 Chrome major versions',
            'unreleased Chrome versions',
            'last 3 Edge major versions',
        ];
    }

    /**
     * Update package.json file.
     * @return {void}
     */
    save() {
        this.packageJson.writeJson(this.json);
    }

    /**
     * Load package.json data from file.
     * @return {void}
     */
    load() {
        this.json = this.packageJson.readJson();
    }

    /**
     * Get a field from the package.json.
     * @param {string} key The field name to retrieve.
     * @return {*} The value of the field.
     */
    get(key) {
        return keypath.get(this.json, key);
    }

    /**
     * Set a field to the package.json.
     * @param {string} key The field name to update.
     * @param {*} value The value to set.
     * @return {Object} The updated JSON.
     */
    set(key, value) {
        if (typeof key === 'object') {
            for (let k in key) {
                this.set(k, key[k]);
            }
            return this.json;
        }
        keypath.set(this.json, key, value);
        return this.json;
    }

    /**
     * Unset a field from the package.json.
     * @param {string} key The field name.
     * @return {Object} The updated JSON.
     */
    unset(key) {
        keypath.del(this.json, key);
        return this.json;
    }

    /**
     * Resolve patterns from the current project.
     * If the project is a monorepo, resolve packages names as Project instances.
     * @param {Array<string>|string} patterns The glob patterns to resolve.
     * @return {Array<Project|File|Directory>} The list of resolved entries.
     */
    resolve(patterns) {
        let workspaces = this.workspaces;
        if (!workspaces) {
            return super.resolve(patterns);
        }

        if (!Array.isArray(patterns)) {
            patterns = [patterns];
        }

        let files = [];
        let filesPatterns = patterns.filter((pattern) => {
            let matchProject = workspaces.find((project) => project.get('name') === pattern);
            if (matchProject) {
                files.push(matchProject);
                return false;
            }
            return true;
        });

        files.push(...super.resolve(filesPatterns));

        return files;
    }

    /**
     * Set repository field in package.json.
     * @param {string} url The url of the repository.
     * @param {string} type The type of the repository.
     * @return {void}
     */
    setRepository(url, type = 'git') {
        this.set('repository', {
            type,
            url,
        });
    }

    async publish(version, git, npm) {
        if (this.git.check() && this.git.hasChanges()) {
            throw new Error(`uncommitted or unpushed changes in the repository ${this.git.cwd}`);
        }

        const parent = this.parent;
        const workspaces = this.workspaces;
        if ((workspaces && this.file('lerna.json').exists()) || (parent && parent.file('lerna.json').exists())) {
            return await this.publishWithLerna(version, git, npm);
        }

        const projects = [this, ...(workspaces || [])];
        const crypto = require('crypto');
        const semver = require('semver');

        let args = ['--no-git-tag-version'];
        let hash = this.git.check() && this.git.getShortCommitCode() || crypto.createHash('md5').update(current).digest('hex');
        let tag;
        let current = this.get('version');
        let newVersion;
        if (version === 'canary') {
            tag = 'alpha';
            newVersion = semver.inc(current, 'prerelease', 'alpha').replace(/\.\d+$/, `.${hash.trim()}`);
        } else if (version === 'alpha') {
            tag = 'alpha';
            newVersion = semver.inc(current, 'prerelease', 'alpha');
        } else if (version === 'beta') {
            tag = 'beta';
            newVersion = semver.inc(current, 'prerelease', 'beta');
        } else if (version === 'rc') {
            tag = 'rc';
            newVersion = semver.inc(current, 'prerelease', 'rc');
        } else if (version === 'patch') {
            newVersion = semver.inc(current, 'patch');
        } else if (version === 'minor') {
            newVersion = semver.inc(current, 'minor');
        } else if (version === 'major') {
            newVersion = semver.inc(current, 'major');
        } else if (version) {
            newVersion = version;
        } else if (!process.env.CI) {
            // prompt
            const answers = await inquirer.prompt([
                {
                    name: 'version',
                    message: 'select the version to bump',
                    type: 'list',
                    choices: [
                        `patch (${semver.inc(current, 'patch')})`,
                        `minor (${semver.inc(current, 'minor')})`,
                        `major (${semver.inc(current, 'major')})`,
                        `alpha (${semver.inc(current, 'prerelease', 'alpha')})`,
                        `beta (${semver.inc(current, 'prerelease', 'beta')})`,
                        `rc (${semver.inc(current, 'prerelease', 'rc')})`,
                        `canary (${semver.inc(current, 'prerelease', 'alpha').replace(/\.\d+$/, `.${hash.trim()}`)})`,
                    ],
                },
            ]);
            return await this.publish(answers.version.split(' ')[0], git, npm);
        }

        if (!newVersion) {
            throw new Error('missing version to publish');
        }

        if (workspaces) {
            await Promise.all(
                [this, ...workspaces].map((p) => p.packageManager.version(newVersion, args))
            );
        } else {
            await this.packageManager.version(newVersion, args);
        }

        if (this.git.check() && git) {
            await this.git.release(newVersion);
        }

        if (npm) {
            if (workspaces) {
                await Promise.all(
                    projects.map((p) => p.packageManager.publish(tag))
                );
            } else {
                await this.packageManager.publish(tag);
            }
        }
    }

    async publishWithLerna(version, git = true, npm = true) {
        const exec = require('./lib/exec');
        const BIN = require.resolve('lerna/cli.js');

        let command = npm === false ? 'version' : 'publish';
        let args = ['--force-publish'];
        if (git === false || !this.git.check()) {
            args.push('--no-git-tag-version', '--no-push');
        } else {
            args.push('--push');
        }
        if (version === 'canary') {
            args.push('--canary');
        } else if (version === 'alpha') {
            args.push('--canary', '--preid alpha');
        } else if (version === 'beta') {
            args.push('--canary', '--preid beta');
        } else if (version === 'rc') {
            args.push('--canary', '--preid rc');
        } else if (version === 'patch') {
            args.unshift('patch');
        } else if (version === 'minor') {
            args.unshift('minor');
        } else if (version === 'major') {
            args.unshift('major');
        } else if (version) {
            args.unshift(version);
        }
        if (process.env.CI) {
            args.push('--yes');
        }

        return await exec(BIN, [command, ...args]);
    }
}

module.exports = {
    Entry,
    File,
    Directory,
    Project,
};