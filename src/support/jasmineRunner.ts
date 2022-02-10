import {SpecReporter, StacktraceOption} from 'jasmine-spec-reporter';

const reporter = new SpecReporter({
  spec: {
    displayDuration: true
  },
  summary: {
    displayStacktrace: StacktraceOption.PRETTY
  },
  print: (log: string) => {
    process.stdout.write(`${log}\n`);
  }
});

jasmine.getEnv().clearReporters();
jasmine.getEnv().addReporter(reporter);