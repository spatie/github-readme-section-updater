const { Octokit } = require('@octokit/rest');
require('dotenv').config();
const { workflowCode } = require('./copy');

const octokit = new Octokit({ auth: process.env.GITHUB_API_KEY, userAgent: 'spatie-update-script' });

function getAllPublicRepoNames(page = 1) {
    return new Promise((resolve) => {
        octokit.repos.listForOrg({ org: 'spatie', per_page: 100, page }).then(async (response) => {
            let publicRepos = response.data
                .filter((repo) => !repo.private)
                .filter((repo) => repo.default_branch === 'main') // only where default branch === 'main'
                .map((r) => ({ name: r.name, html_url: r.html_url }));

            if (response.data.length === 100) {
                const moreRepos = await getAllPublicRepoNames(page + 1);
                publicRepos = publicRepos.concat(moreRepos);
            }

            resolve(publicRepos);
        });
    });
}

const workflowPath = '.github/workflows/update-changelog.yml';

function addWorkflowScript(repoInfo, repoURL) {
    return new Promise(async (resolve) => {
        try {
            let response;

            // already done?
            try {
                response = await octokit.repos.getContents({ ...repoInfo, path: workflowPath });

                // workflow exists, bail
                console.log(`${repoInfo.repo}: Workflow already exists, continuing. (${repoURL})`);
                return resolve();
            } catch (error) {
                // workflow doesn't exist yet, continue
            }

            console.log(`${repoInfo.repo}: Adding script… (${repoURL})`);

            try {
                await octokit.repos.createOrUpdateFileContents({
                    ...repoInfo,
                    path: workflowPath,
                    message: 'Add changelog workflow (automated commit)',
                    content: workflowCode,
                    sha: response ? response.data.sha : undefined,
                });

                console.log(repoURL, 'updated');
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
            console.log('something went wrong while updating', repoInfo.repo, repoURL);
            console.log(error);
        }

        resolve();
    });
}

let runAll = false;
function askUserInput() {
    return new Promise((resolve) => {
        if (runAll) {
            return resolve();
        }

        console.log('\nPress "a" to edit all repos, press "c" to exit, press any other key to step to the next repo\n');

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

getAllPublicRepoNames().then((allRepos) => {
    allRepos.reduce((prev, currRepo) => {
        return new Promise(async (resolve) => {
            await prev;

            await askUserInput();

            console.log('updating', currRepo.name, currRepo.html_url);

            try {
                // check if repo has a .github dir
                await octokit.repos.getContent({ owner: 'spatie', repo: currRepo.name, path: '.github' });
            } catch (error) {
                console.log(`Skipping ${currRepo.name}, it has no .github directory. (${currRepo.html_url})`);
                return resolve();
            }

            await addWorkflowScript({ owner: 'spatie', repo: currRepo.name }, currRepo.html_url);

            resolve();
        });
    }, Promise.resolve());
});
