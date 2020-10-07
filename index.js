const { Octokit } = require('@octokit/rest');
require('dotenv').config();
const { newSupportSection } = require('./copy');

const octokit = new Octokit({ auth: process.env.GITHUB_API_KEY });

function getAllPublicRepoNames(page = 1) {
    return new Promise((resolve) => {
        octokit.repos.listForOrg({ org: 'spatie', per_page: 100, page }).then(async (response) => {
            let publicRepos = response.data
                .filter((repo) => !repo.private)
                .map((r) => ({ name: r.name, html_url: r.html_url }));

            if (response.data.length === 100) {
                const moreRepos = await getAllPublicRepoNames(page + 1);
                publicRepos = publicRepos.concat(moreRepos);
            }

            resolve(publicRepos);
        });
    });
}

function removeSupportSection(readme) {
    const indexOfSupportUsSection = readme.indexOf('## Support us');

    if (indexOfSupportUsSection === -1) {
        return readme;
    }

    let indexOfNextSection;

    const nextBigSectionIndex = readme.indexOf('\n# ', indexOfSupportUsSection + 1);
    const nextMedSectionIndex = readme.indexOf('\n## ', indexOfSupportUsSection + 1);

    if (nextBigSectionIndex === -1 && nextMedSectionIndex === -1) {
        // No next section, remove until end of file
        indexOfNextSection = readme.length - 1;
    }
    if (nextBigSectionIndex === -1 && nextMedSectionIndex !== -1) {
        indexOfNextSection = nextMedSectionIndex;
    }
    if (nextBigSectionIndex !== -1 && nextMedSectionIndex === -1) {
        indexOfNextSection = nextBigSectionIndex;
    }

    return readme.substr(0, indexOfSupportUsSection) + readme.substr(indexOfNextSection);
}

function addNewSupportSection(readme) {
    let indexToPlaceSupportSection = readme.indexOf('\n##');

    if (indexToPlaceSupportSection === -1) {
        indexToPlaceSupportSection = readme.length - 1;
    }

    const readmeWithNewSupportUsSection =
        readme.substr(0, indexToPlaceSupportSection) + newSupportSection + readme.substr(indexToPlaceSupportSection);

    return readmeWithNewSupportUsSection;
}

function checkIfPatreonSectionStillExists(readme, repoName, repoURL) {
    if (readme.includes('patreon') || readme.includes('Patreon') || readme.includes('https://www.patreon.com/spatie')) {
        console.log(repoName, 'still has a Patreon block.', repoURL);
    }
}

function replaceImageAndRemoveCopy(readme, repoName) {
    if (readme.includes('https://spatie.be/github-ad-click')) {
        console.log(repoName, 'was already updated');

        return { shouldUpdate: false };
    }

    if (!readme.includes('[![Laravel Package training]')) {
        console.log(repoName, 'does not have the laravel-package-training image');

        return { shouldUpdate: false };
    }

    let updatedReadme = readme;

    const indexStartRemove = updatedReadme.indexOf(
        'Learn how to create a package like this one, by watching our premium video course'
    );
    const indexImage = updatedReadme.indexOf('(https://laravelpackage.training)', indexStartRemove);
    const indexEndRemove = updatedReadme.indexOf('\n', indexImage);

    updatedReadme =
        updatedReadme.substr(0, indexStartRemove) +
        `[![Image](https://github-ads.s3.eu-central-1.amazonaws.com/${repoName}.jpg)](https://spatie.be/github-ad-click/${repoName})` +
        updatedReadme.substr(indexEndRemove);

    return { updatedReadme, shouldUpdate: true };
}

function updateReadme(repoInfo, repoURL) {
    return new Promise(async (resolve) => {
        try {
            let response;

            // README.md vs readme.md
            let filename = 'readme.md';
            try {
                response = await octokit.repos.getContents({ ...repoInfo, path: filename });
            } catch (error) {
                if (error.message === 'Not Found') {
                    filename = 'README.md';
                    response = await octokit.repos.getContents({ ...repoInfo, path: filename });
                }
            }

            let readme = Buffer.from(response.data.content, 'base64').toString();

            checkIfPatreonSectionStillExists(readme, repoInfo.repo, repoURL);

            let { updatedReadme, shouldUpdate } = replaceImageAndRemoveCopy(readme, repoInfo.repo);

            if (!shouldUpdate) {
                console.log('skipped', repoInfo.repo, repoURL);
                return resolve();
            }

            // Because of the different cases, sometimes there will be triple newlines, which we don't want
            updatedReadme = updatedReadme.replace(/(\n{3,})\#/g, '\n\n#');
            updatedReadme = updatedReadme.replace(/(\n{2,})$/g, '\n');

            try {
                await octokit.repos.createOrUpdateFile({
                    ...repoInfo,
                    path: filename,
                    message: 'Update README with new "Support us" section',
                    content: Buffer.from(updatedReadme).toString('base64'),
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

            await updateReadme({ owner: 'spatie', repo: currRepo.name }, currRepo.html_url);

            resolve();
        });
    }, Promise.resolve());
});

/* [
    { name: 'github-api-tester', html_url: 'https://github.com/AdrianMrn/github-api-tester/blob/master/README.md' },
].reduce((prev, currRepo) => {
    return new Promise(async (resolve) => {
        await prev;

        console.log('updating', currRepo.name, currRepo.html_url);

        await updateReadme({ owner: 'AdrianMrn', repo: currRepo.name });

        resolve();
    });
}, Promise.resolve()); */
