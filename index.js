const { Octokit } = require('@octokit/rest');
require('dotenv').config();
const { newCopy, oldCopies } = require('./copy');

const octokit = new Octokit({ auth: process.env.GITHUB_API_KEY });

function getAllPublicRepoNames(page = 1) {
    return new Promise((resolve) => {
        octokit.repos.listForOrg({ org: 'spatie', per_page: 100, page }).then(async (response) => {
            let publicRepos = response.data.map((r) => ({ name: r.name, html_url: r.html_url }));

            if (response.data.length === 100) {
                const moreRepos = await getAllPublicRepoNames(page + 1);
                publicRepos = publicRepos.concat(moreRepos);
            }

            resolve(publicRepos);
        });
    });
}

function updateReadme(repoInfo, repoURL) {
    return new Promise(async (resolve) => {
        try {
            let response;

            // README.md vs readme.md
            let filename = 'README.md';
            try {
                response = await octokit.repos.getContents({ ...repoInfo, path: 'README.md' });
            } catch (error) {
                if (error.message.includes('Not Found')) {
                    try {
                        response = await octokit.repos.getContents({ ...repoInfo, path: 'readme.md' });
                        filename = 'readme.md';
                    } catch (error) {
                        if (error.message.includes('Not Found')) {
                            return resolve();
                        }
                    }
                }
            }

            let readme = Buffer.from(response.data.content, 'base64').toString();

            let hasCopy = false;

            oldCopies.forEach((oldCopy) => {
                if (readme.includes(oldCopy)) {
                    readme = readme.replace(oldCopy, newCopy);
                    hasCopy = true;
                }
            });

            if (!hasCopy) {
                console.log('skipped', repoURL, 'because it did not have the copy.');
                return resolve();
            }

            try {
                await octokit.repos.createOrUpdateFile({
                    ...repoInfo,
                    path: filename,
                    message: 'Change copy',
                    content: Buffer.from(readme).toString('base64'),
                    sha: response.data.sha,
                });

                console.log('updated', repoURL);
            } catch (error) {
                if (error.message.includes('archived')) {
                    console.log('skipped', repoInfo.repo, 'because it is read-only');
                } else if (error.message.includes('repository is empty')) {
                    console.log('skipped', repoInfo.repo, 'because it is empty');
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.log('something went wrong while updating', repoInfo.repo);
            console.log(error);
        }

        resolve();
    });
}

const filesToRemove = [
    'SECURITY.md',
    'CONTRIBUTING.md',
    'FUNDING.md',
    '.github/SECURITY.md',
    '.github/CONTRIBUTING.md',
    '.github/FUNDING.md',
];

function removeAllFiles(repoInfo, repoURL) {
    return new Promise(async (resolve) => {
        try {
            for (const file of filesToRemove) {
                await removeFile(repoInfo, file);
            }
        } catch (error) {
            console.log('something went wrong while updating', repoInfo.repo, repoURL);
            console.log(error);
        }

        resolve();
    });
}

function removeFile(repoInfo, path) {
    return new Promise(async (resolve) => {
        try {
            let response;

            console.log('removing file', path, 'in', repoInfo.repo);

            try {
                response = await octokit.repos.getContents({ ...repoInfo, path });
            } catch (error) {
                if (error.message.includes('Not Found')) {
                    return resolve();
                } else {
                    throw error;
                }
            }

            try {
                await octokit.repos.deleteFile({
                    ...repoInfo,
                    path,
                    message: 'Use organisation-wide community health files',
                    sha: response.data.sha,
                });
            } catch (error) {
                if (error.message.includes('archived')) {
                    // noop
                } else if (error.message.includes('repository is empty')) {
                    // noop
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.log('something went wrong while updating', repoInfo.repo);
            console.log(error);
        }

        resolve();
    });
}

let runAll = false;
function askUserInput(nextRepoName) {
    return new Promise((resolve) => {
        if (runAll) {
            return resolve();
        }

        console.log(
            `\nPress "a" to edit all repos, press "c" to exit, press any other key to step to the next repo (${nextRepoName})\n`
        );

        process.stdin.setRawMode(true);
        process.stdin.resume();

        process.stdin.on('data', (key) => {
            process.stdin.removeAllListeners();
            process.stdin.pause();

            if (Buffer.from(key).toString() === 'a') {
                runAll = true;
            }

            if (Buffer.from(key).toString() === 'c') {
                process.exit();
            }

            resolve();
        });
    });
}

getAllPublicRepoNames(3).then((allRepos) => {
    allRepos.reduce((prev, currRepo) => {
        return new Promise(async (resolve) => {
            await prev;

            await askUserInput(currRepo.name);

            console.log('updating', currRepo.name, currRepo.html_url);

            /* await updateReadme({ owner: 'spatie', repo: currRepo.name }, currRepo.html_url); */
            await removeAllFiles({ owner: 'spatie', repo: currRepo.name }, currRepo.html_url);

            resolve();
        });
    }, Promise.resolve());
});
