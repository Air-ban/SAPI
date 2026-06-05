package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"sapi/config"
	"sapi/models"
	"sapi/store"
)

func TestGitHubFollowCheckUsesPublicFollowingEndpoint(t *testing.T) {
	originalBaseURL := githubAPIBaseURL
	originalClient := githubHTTPClient
	defer func() {
		githubAPIBaseURL = originalBaseURL
		githubHTTPClient = originalClient
	}()

	following := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/candidate/following/EterUltimate" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
			t.Fatalf("Accept = %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "SAPI" {
			t.Fatalf("User-Agent = %q", got)
		}
		if following {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	githubAPIBaseURL = server.URL
	githubHTTPClient = server.Client()

	ok, err := isGitHubUserFollowing(context.Background(), "", "candidate", "EterUltimate")
	if err != nil {
		t.Fatalf("follow check returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected following user to be allowed")
	}

	following = false
	ok, err = isGitHubUserFollowing(context.Background(), "", "candidate", "EterUltimate")
	if err != nil {
		t.Fatalf("follow check returned error: %v", err)
	}
	if ok {
		t.Fatal("expected non-following user to be rejected")
	}
}

func TestGitHubRegistrationRequiresConfiguredFollowTarget(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{}
		return nil
	})

	cfg := &config.Config{AdminUser: "admin", GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate", Name: "Candidate"}

	if result := upsertGitHubUser(profile, nil, cfg, false); result != "github_follow_required" {
		t.Fatalf("result = %#v, want github_follow_required", result)
	}

	result := upsertGitHubUser(profile, nil, cfg, true)
	user, ok := result.(*models.User)
	if !ok {
		t.Fatalf("result = %#v, want *models.User", result)
	}
	if user.Source != "github" || user.GitHubLogin != "candidate" {
		t.Fatalf("created user = %#v", user)
	}
}

func TestGitHubFollowRequirementSkipsExistingLinkedUser(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:          "usr_existing",
			Username:    "existing",
			Enabled:     true,
			Source:      "github",
			GitHubID:    "42",
			GitHubLogin: "candidate",
		}}
		return nil
	})

	cfg := &config.Config{GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate"}

	if shouldCheckGitHubFollowRequirement(profile, cfg) {
		t.Fatal("expected linked GitHub user to skip follow check on login")
	}
}
