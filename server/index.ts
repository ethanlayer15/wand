    setTimeout(() => {
      autoReprocessAirbnbData().catch((err: any) => {
        console.error('[Startup] Auto-reprocess Airbnb data failed:', err.message);
      });
    }, 5000); // Wait 5s for DB connection to stabilize

    // Start compensation cron jobs (daily rolling score recalculation)
    startCronJobs();
  });
}

startServer().catch(console.error);
