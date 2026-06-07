package config

import "testing"

func TestParseGitHubHostResolve(t *testing.T) {
	got := parseGitHubHostResolve("github.com=140.82.113.3, https://api.github.com=140.82.114.5 ,bad,example.com=not-an-ip")
	if got["github.com"] != "140.82.113.3" {
		t.Fatalf("github.com = %q, want 140.82.113.3", got["github.com"])
	}
	if got["api.github.com"] != "140.82.114.5" {
		t.Fatalf("api.github.com = %q, want 140.82.114.5", got["api.github.com"])
	}
	if _, ok := got["example.com"]; ok {
		t.Fatalf("example.com mapping should be ignored: %#v", got)
	}
}

func TestParseGitHubHostResolveReturnsNilForEmptyOrInvalidValue(t *testing.T) {
	if got := parseGitHubHostResolve(""); got != nil {
		t.Fatalf("empty value = %#v, want nil", got)
	}
	if got := parseGitHubHostResolve("bad,github.com=bad-ip"); got != nil {
		t.Fatalf("invalid value = %#v, want nil", got)
	}
}
