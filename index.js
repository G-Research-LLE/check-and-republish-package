const core = require('@actions/core');
const github = require('@actions/github');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    try {
        // `who-to-greet` input defined in action metadata file
        const nameToGreet = core.getInput('who-to-greet');
        console.log(`Hello ${nameToGreet}!`);
        console.log('source-owner = ' + core.getInput('source-owner'));
        console.log('source-repo = ' + core.getInput('source-repo'));
        const time = (new Date()).toTimeString();
        core.setOutput("time", time);
        // Get the JSON webhook payload for the event that triggered the workflow
        const payload = JSON.stringify(github.context.payload, undefined, 2)
        console.log(`The event payload: ${payload}`);

        const sourceOwner = core.getInput('source-owner');
        const sourceRepo = core.getInput('source-repo');

        const clientPayload = github.context.payload.client_payload;
        const pat = clientPayload.pat;
        const workflowName = clientPayload.workflow_name;
        const jobName = clientPayload.job_name;
        const runNumber = clientPayload.run_number;
        const packageName = clientPayload.package_name;
        const packageVersion = clientPayload.package_version;

        const octokit = github.getOctokit(pat);
        
        const {data: {workflows}} = await octokit.actions.listRepoWorkflows({owner: sourceOwner, repo: sourceRepo});
        const workflow = workflows.find(workflow => workflow.name == workflowName);
        console.log(workflow);
        
        const {data: {workflow_runs: workflowRuns}} = await octokit.actions.listWorkflowRuns({owner: sourceOwner, repo: sourceRepo, workflow_id: workflow.id});
        const workflowRun = workflowRuns.find(workflowRun => workflowRun.run_number == runNumber);
        console.log(workflowRun);
        
        const {data: {jobs}} = await octokit.actions.listJobsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
        var job = jobs.find(job => job.name == jobName);
        console.log(job);

        while (job.status != 'completed') {
            console.log('Job status is ' + job.status + ', sleeping for 10 seconds to give it a chance to finish')
            await sleep(10000);
            const {data} = await octokit.actions.getJobForWorkflowRun({owner: sourceOwner, repo: sourceRepo, job_id: job.id});
            job = data;
        }
        
        console.log('Downloading logfrom job');
        const {data: log} = await octokit.actions.downloadJobLogsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, job_id: job.id});
        const logLines = log.split(/\r?\n/)
        console.log(logLines);

        console.log('Searching log for package publishing events');
        var packagesPublishedByJob = [];
        for (logLine of logLines) {
            const matches = logLine.match(/Published package [^ ]+ version [^ ]+/)
            if (matches != null) {
                console.log(matches);
            }
        }

        //const x = octokit.actions.getWorkflowRun({
        //    sourceOwner,
        //    sourceRepo,
        //    run_id,
        //  });



    } catch (error) {
        core.setFailed(error.message);
    }
})();
