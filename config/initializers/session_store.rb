# Be sure to restart your server when you modify this file.

# Your secret key for verifying cookie session data integrity.
# If you change this key, all old sessions will become invalid!
# Make sure the secret is at least 30 characters and all random, 
# no regular words or you'll be exposed to dictionary attacks.
ActionController::Base.session = {
  :key         => '_planonme_session',
  :secret      => '5c365b9c12a3934cee46216aa3ae6283618bb85dbf5b854b5b6d902f297ef0d451a2ae83364aa1d4190ccaefb27f908f18b9898726b250e93c2525918be9c2d3'
}

# Use the database for sessions instead of the cookie-based default,
# which shouldn't be used to store highly confidential information
# (create the session table with "rake db:sessions:create")
# ActionController::Base.session_store = :active_record_store
