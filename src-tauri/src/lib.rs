mod fs;
mod git;
mod keys;
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(pty::PtyState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      git::git_full_repository,
      git::git_commit_details,
      git::git_status,
      git::git_checkout_branch,
      pty::spawn_pty,
      pty::write_pty,
      pty::resize_pty,
      pty::kill_pty,
      fs::agent_read_file,
      fs::agent_write_file,
      fs::agent_list_dir,
      fs::agent_grep,
      fs::agent_run_command,
      fs::agent_read_file_bytes,
      fs::walk_tree,
      fs::get_api_key,
      fs::get_provider_key,
      fs::check_cli_provider,
      keys::set_secure_key,
      keys::get_secure_key,
      keys::delete_secure_key,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
