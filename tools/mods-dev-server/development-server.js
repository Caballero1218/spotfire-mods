#!/usr/bin/env node

/*
 * Copyright © 2020. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

//@ts-check

/**
 * # Spotfire mods development server
 * The purpose of the development server is to simplify the development of mods.
 * The development server mimics the way the Spotfire runtime works in regards to cross origin requests and content security policies.
 */

const devServer = require("./server");
const path = require("path");
const fs = require("fs");

const manifestName = "mod-manifest.json";

/**
 * The development server tries to mimic the CSP policy used by the Spotfire runtime.
 * External resources declared in manifest are added to the server's CSP policy.
 * @type {string[]}
 */
let declaredExternalResourcesInManifest = [];
const allowedOrigins = new Set();

/** @type {import("live-server").LiveServerParams} */
const defaultConfig = {
    port: 8090,
    noCssInject: true,
    cors: false,
    // @ts-ignore
    open: "/" + manifestName,
    root: "./test/test-files/",
    wait: 250, // Waits for all changes, before reloading. Defaults to 0 sec.
    middleware: [cacheRedirect]
};

module.exports.start = startServer;

// Run the server stand-alone as a node script
// @ts-ignore
if (require.main === module) {
    try {
        startServer({
            // root: process.argv[2] || "./src/"
        });
    } catch (err) {
        console.warn(err);
        process.exit(1);
    }
}

/**
 * Start a liver server with CSP policies mimicing the Spotfire Mod environment.
 * @param {import("live-server").LiveServerParams} partialConfig
 */
function startServer(partialConfig = {}) {
    const config = {
        ...defaultConfig,
        ...partialConfig
    };

    const rootDirectoryAbsolutePath = path.resolve(config.root);

    if (!fs.existsSync(rootDirectoryAbsolutePath)) {
        throw `The path '${rootDirectoryAbsolutePath}' does not exist.`;
    }

    readExternalResourcesFromManifest(rootDirectoryAbsolutePath);

    return devServer.start(config);
}

/**
 * Read external resources from the mod manifest placed in the root directory.
 * @param {string} rootDirectoryAbsolutePath
 */
function readExternalResourcesFromManifest(rootDirectoryAbsolutePath) {
    const files = fs.readdirSync(rootDirectoryAbsolutePath);

    if (files.find((fileName) => fileName == manifestName)) {
        const manifestPath = path.join(rootDirectoryAbsolutePath, manifestName);

        readExternalResources();
        fs.watch(manifestPath, {}, readExternalResources);

        async function readExternalResources() {
            let content = fs.readFileSync(manifestPath, { encoding: "utf-8" });

            try {
                let json = JSON.parse(content);
                declaredExternalResourcesInManifest = json.externalResources || [];
            } catch (err) {}
        }
    } else {
        console.warn("Could not find a mod-manifest.json in the root directory", rootDirectoryAbsolutePath);
    }
}

/**
 * Middleware to manage caching and CSP headers.
 * @param {any} req - request object
 * @param {any} res - response object
 * @param {any} next - next callback to invoke the next middleware
 */
function cacheRedirect(req, res, next) {
    const isCorsRequest = req.headers.origin != undefined;
    const requestFromOutsideSandbox = req.headers.origin != "null";

    // Prevent CORS requests from the sandboxed iframe. E.g module loading will not work in embedded mode.
    if (isCorsRequest && requestFromOutsideSandbox) {
        allowedOrigins.add(req.headers.origin);

        res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        res.setHeader("Access-Control-Allow-Origin", "*");
    }

    // Turn off caching on everything to avoid stale CSP headers etc. in the browser.
    // This also ensures that live server can inject its websocket snippet in .html pages it serves to the mod iframe.
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        next();
        return;
    }

    // Set same security headers in the development server as in the Spotfire runtime.
    res.setHeader(
        "content-security-policy",
        `sandbox allow-scripts; default-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: ${[
            ...allowedOrigins.values(),
            ...declaredExternalResourcesInManifest
        ].join(" ")}`
    );

    // CSP header used by older browsers where the CSP policy is not fully supported.
    res.setHeader("x-content-security-policy", "sandbox allow-scripts");

    next();
}
