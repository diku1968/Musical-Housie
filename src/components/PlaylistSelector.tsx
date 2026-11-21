const handleLoadYouTube = async () => {
    setError('');
    setWarning('');
    setProblemTracks([]);

    const rawInput = ytUrl.trim();
    const localPlaylistId = extractYouTubePlaylistId(rawInput);
    const extractedUrl = extractFirstUrlFromInput(rawInput);

    if (!localPlaylistId && !extractedUrl) {
      setError(
        'Please paste a valid YouTube playlist URL (e.g., https://youtube.com/playlist?list=PL...).',
      );
      return;
    }

    setLoading(true);
    try {
      let resolvedTracks: TrackItem[] = [];
      let detectedProblems: ProblemTrackItem[] = [];
      let playlistName = 'YouTube Playlist';
      let skipped = 0;
      const resolvedPlaylistId = localPlaylistId || '';

      if (!resolvedPlaylistId) {
        throw new Error('Please enter a valid YouTube Playlist URL containing a list ID (list=...).');
      }

      // Bypass non-existent backend API directly on GitHub Pages
      // Use YouTube IFrame directly inside browser
      const iframeResult = await resolvePlaylistViaYouTubeIFrame(resolvedPlaylistId);
      
      if (!iframeResult.tracks || iframeResult.tracks.length === 0) {
        throw new Error('Could not load songs from this playlist. Ensure the playlist is Public or Unlisted.');
      }

      resolvedTracks = iframeResult.tracks;
      detectedProblems = iframeResult.problemTracks || [];
      skipped = iframeResult.skippedRestricted || detectedProblems.length;

      const canonicalPlaylistUrl = normalizeYouTubePlaylistUrl(resolvedPlaylistId);

      setProblemTracks(detectedProblems);

      if (skipped > 0) {
        setWarning(
          `${skipped} problem video(s) cannot be played in the app and were excluded.`,
        );
      }

      if (resolvedTracks.length < 15) {
        setWarning(
          `Only ${resolvedTracks.length} playable songs found. At least 15 playable songs are required to generate tickets.`,
        );
      }

      setYtUrl(canonicalPlaylistUrl);

      await onPlaylistLoaded({
        sourceType: 'youtube',
        playlistName,
        playlistUrl: canonicalPlaylistUrl,
        tracks: resolvedTracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load YouTube playlist.');
    } finally {
      setLoading(false);
    }
  };
